import crypto from 'node:crypto';
import { ChimeCompositionModel, type ChimeCompositionDoc } from '../../models/chime.js';
import { InvalidInputError, paginate, type Page, type PageArgs } from '../cursor.js';
import { creatorHash } from '../device-key.js';
import { fingerprint } from './fingerprint.js';
import { UnitsInputSchema } from './shape.js';
import { compositionTitle } from './title.js';

/*
 * Every chime-composition query and write goes through this module, and
 * visibility is decided here only. Public = `hidden: false`; admins see
 * everything. Saves are anonymous: a document records the units and what the
 * API derived from them, never who or where it came from. A save may carry the
 * browser's device key; only its hash is kept, on the composition it created.
 */

const CREATOR_SALT = 'chime-creator';

export class ChimeCompositionNotFoundError extends Error {
  constructor(id: string) {
    super(`No chime composition with id: ${id}`);
    this.name = 'ChimeCompositionNotFoundError';
  }
}

const PUBLIC_FILTER = { hidden: false } as const;
const newestFirst = { createdAt: -1, _id: -1 } as const;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

/** zod's first complaint, as `units[2].decay: Too big…`, for `BAD_USER_INPUT`. */
function invalid(issue: { path: PropertyKey[]; message: string }): InvalidInputError {
  const [index, ...rest] = issue.path;
  const where = index === undefined ? 'units' : `units[${String(index)}]${rest.map((p) => `.${String(p)}`).join('')}`;
  return new InvalidInputError(`${where}: ${issue.message}`);
}

/**
 * Save a composition, or return the identical one already stored
 * (`created: false`). The unique fingerprint index settles two identical saves
 * racing each other. The creator's hash goes only on a new document: a
 * duplicate is returned untouched, so another key never takes it over.
 */
export async function saveComposition(input: unknown, creatorKey?: string | null): Promise<{ composition: ChimeCompositionDoc; created: boolean }> {
  const owner = creatorKey == null ? undefined : creatorHash(CREATOR_SALT, creatorKey);
  const parsed = UnitsInputSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]);
  const units = parsed.data;
  const print = fingerprint(units);

  const doc: ChimeCompositionDoc = {
    _id: crypto.randomBytes(12).toString('hex'),
    schemaVersion: 1,
    title: compositionTitle(units, print),
    units,
    fingerprint: print,
    hidden: false,
    createdAt: new Date().toISOString(),
    ...(owner ? { creatorHash: owner } : {}),
  };
  try {
    await ChimeCompositionModel.create(doc);
    return { composition: doc, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await ChimeCompositionModel.findOne({ fingerprint: print }).lean<ChimeCompositionDoc>().exec();
    if (!existing) throw error;
    return { composition: existing, created: false };
  }
}

/** The public listing: visible, newest first, optionally only the compositions one device key created. */
export function listVisibleCompositions(args: PageArgs, { creatorKey }: { creatorKey?: string | null } = {}): Promise<Page<ChimeCompositionDoc>> {
  const filter: Record<string, unknown> = { ...PUBLIC_FILTER };
  if (creatorKey) filter.creatorHash = creatorHash(CREATOR_SALT, creatorKey);
  return paginate(args, filter, (filter, limit) =>
    ChimeCompositionModel.find(filter).sort(newestFirst).limit(limit).lean<ChimeCompositionDoc[]>().exec(),
  );
}

/** Whether a device key created this composition. A malformed key, or a composition without an owner, is false. */
export function isCompositionCreator(doc: ChimeCompositionDoc, creatorKey: string): boolean {
  if (!doc.creatorHash) return false;
  try {
    return doc.creatorHash === creatorHash(CREATOR_SALT, creatorKey);
  } catch {
    return false;
  }
}

/** By id, in input order. Hidden ones are null except for admins, indistinguishable from missing. */
export async function loadCompositions(ids: readonly string[], isAdmin: boolean): Promise<(ChimeCompositionDoc | null)[]> {
  const docs = await ChimeCompositionModel.find({ _id: { $in: ids } }).lean<ChimeCompositionDoc[]>().exec();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.map((id) => {
    const doc = byId.get(id);
    return doc && (isAdmin || !doc.hidden) ? doc : null;
  });
}

/** Admin only (enforced by the mutation's scope). Nothing deletes a composition. */
export async function setCompositionHidden(id: string, hidden: boolean): Promise<ChimeCompositionDoc> {
  const doc = await ChimeCompositionModel.findOneAndUpdate({ _id: id }, { $set: { hidden } }, { new: true })
    .lean<ChimeCompositionDoc>()
    .exec();
  if (!doc) throw new ChimeCompositionNotFoundError(id);
  return doc;
}
