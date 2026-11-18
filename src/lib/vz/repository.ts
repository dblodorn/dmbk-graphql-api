import crypto from 'node:crypto';
import { VzVoiceModel, type VzVoiceDoc } from '../../models/vz.js';
import { InvalidInputError, paginate, type Page, type PageArgs } from '../cursor.js';
import { ForbiddenError } from '../lora/repository.js';
import { isNameAllowed } from './names.js';
import { creatorHash, decodeVoice, fingerprint, voiceName } from './shape.js';

/*
 * Every VZ-voice query and write goes through this module, and visibility is
 * decided here only. Saves are anonymous: a voice records its bytes, what the
 * API derived from them, and the hash of the saving browser's device key, never
 * an account, IP or client. Public = `hidden: false`; admins see everything.
 * The device key is the only proof of ownership: with it, a creator can update
 * and delete their voices and filter the listing to them.
 */

export class VzVoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`No VZ voice with id: ${id}`);
    this.name = 'VzVoiceNotFoundError';
  }
}

const PUBLIC_FILTER = { hidden: false } as const;
const newestFirst = { createdAt: -1, _id: -1 } as const;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The bytes, their name and fingerprint, or `InvalidInputError` (bad data, refused name). */
function checked(data: string): { name: string; print: string } {
  const bytes = decodeVoice(data);
  const name = voiceName(bytes);
  if (!isNameAllowed(name)) throw new InvalidInputError(`name: "${name}" isn't allowed. Rename the voice and save again.`);
  return { name, print: fingerprint(bytes) };
}

/**
 * Save a voice for a device key, or return the identical one that key already
 * saved (`created: false`). The unique (creatorHash, fingerprint) index settles
 * two identical saves racing each other.
 */
export async function saveVoice(data: string, creatorKey: string): Promise<{ voice: VzVoiceDoc; created: boolean }> {
  const owner = creatorHash(creatorKey);
  const { name, print } = checked(data);
  const now = new Date().toISOString();
  const doc: VzVoiceDoc = {
    _id: crypto.randomBytes(12).toString('hex'),
    schemaVersion: 1,
    name,
    data,
    fingerprint: print,
    creatorHash: owner,
    hidden: false,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await VzVoiceModel.create(doc);
    return { voice: doc, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await VzVoiceModel.findOne({ creatorHash: owner, fingerprint: print }).lean<VzVoiceDoc>().exec();
    if (!existing) throw error;
    return { voice: existing, created: false };
  }
}

/**
 * A voice its device key may change: NOT_FOUND when it doesn't exist or is
 * hidden (hidden voices can't be told from missing ones), FORBIDDEN when it
 * belongs to another key.
 */
async function owned(id: string, creatorKey: string): Promise<VzVoiceDoc> {
  const owner = creatorHash(creatorKey);
  const doc = await VzVoiceModel.findById(id).lean<VzVoiceDoc>().exec();
  if (!doc || doc.hidden) throw new VzVoiceNotFoundError(id);
  if (doc.creatorHash !== owner) throw new ForbiddenError('Only the device that saved this voice can change it.');
  return doc;
}

/** Replace a voice's bytes (and so its name). Its place in the newest-first listing stays where it was saved. */
export async function updateVoice(id: string, data: string, creatorKey: string): Promise<VzVoiceDoc> {
  const doc = await owned(id, creatorKey);
  const { name, print } = checked(data);
  try {
    const updated = await VzVoiceModel.findOneAndUpdate(
      { _id: id, creatorHash: doc.creatorHash, hidden: false },
      { $set: { name, data, fingerprint: print, updatedAt: new Date().toISOString() } },
      { new: true },
    ).lean<VzVoiceDoc>().exec();
    if (!updated) throw new VzVoiceNotFoundError(id);
    return updated;
  } catch (error) {
    if (isDuplicateKey(error)) throw new InvalidInputError('data: you have already saved an identical voice.');
    throw error;
  }
}

/** Delete a voice for good. */
export async function deleteVoice(id: string, creatorKey: string): Promise<string> {
  const doc = await owned(id, creatorKey);
  await VzVoiceModel.deleteOne({ _id: id, creatorHash: doc.creatorHash });
  return id;
}

export interface VoiceFilter {
  /** Only this device key's voices. */
  creatorKey?: string | null;
  /** Names containing this text, ignoring case. */
  search?: string | null;
}

/** The public listing, newest first, optionally narrowed to a device key's voices or a name search. */
export function listVisibleVoices(args: PageArgs, { creatorKey, search }: VoiceFilter = {}): Promise<Page<VzVoiceDoc>> {
  const filter: Record<string, unknown> = { ...PUBLIC_FILTER };
  if (creatorKey) filter.creatorHash = creatorHash(creatorKey);
  const text = search?.trim();
  if (text) {
    if (text.length > 12) throw new InvalidInputError('search: at most 12 characters (a VZ name is 12).');
    filter.name = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  return paginate(args, filter, (f, limit) => VzVoiceModel.find(f).sort(newestFirst).limit(limit).lean<VzVoiceDoc[]>().exec());
}

/** Whether a device key saved this voice. A malformed key owns nothing. */
export function isCreator(doc: VzVoiceDoc, creatorKey: string): boolean {
  try {
    return doc.creatorHash === creatorHash(creatorKey);
  } catch {
    return false;
  }
}

/** By id, in input order. Hidden ones are null except for admins, indistinguishable from missing. */
export async function loadVoices(ids: readonly string[], isAdmin: boolean): Promise<(VzVoiceDoc | null)[]> {
  const docs = await VzVoiceModel.find({ _id: { $in: ids } }).lean<VzVoiceDoc[]>().exec();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.map((id) => {
    const doc = byId.get(id);
    return doc && (isAdmin || !doc.hidden) ? doc : null;
  });
}

/** Admin only (enforced by the mutation's scope). */
export async function setVoiceHidden(id: string, hidden: boolean): Promise<VzVoiceDoc> {
  const doc = await VzVoiceModel.findOneAndUpdate({ _id: id }, { $set: { hidden } }, { new: true }).lean<VzVoiceDoc>().exec();
  if (!doc) throw new VzVoiceNotFoundError(id);
  return doc;
}
