import {
  PhotoModel,
  KeywordModel,
  PHOTO_SCHEMA_VERSION,
  type PhotoDoc,
  type PhotoStatus,
  type KeywordDoc,
} from '../../models/photos.js';
import { InvalidInputError, paginate, type Page, type PageArgs } from '../cursor.js';
import { applyKeywordDelta, normalizeKeywords, registerKeywordLabels } from './keywords.js';

/*
 * Every photo query goes through this module. Transports (GraphQL resolvers)
 * never build a Mongo filter themselves — they pass a scope, and `scopeFilter`
 * is the only place a visibility or state predicate is constructed. This
 * mirrors dmbk's repository so the two cannot disagree on what is public.
 */

export type Visibility = 'visible' | 'hidden' | 'any';

export interface PhotoScope {
  visibility: Visibility;
  states: PhotoStatus[];
}

/** What every non-admin caller sees: ready and not hidden. Nothing else. */
export const PUBLIC_SCOPE: PhotoScope = { visibility: 'visible', states: ['ready'] };

/** Everything, for admin lookups by id. */
export const ADMIN_SCOPE: PhotoScope = { visibility: 'any', states: ['ready', 'pending', 'failed'] };

function scopeFilter(scope: PhotoScope): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    status: scope.states.length === 1 ? scope.states[0] : { $in: scope.states },
  };
  // `any` deliberately adds no term, so both sides of the flag match.
  if (scope.visibility === 'visible') filter.hidden = false;
  else if (scope.visibility === 'hidden') filter.hidden = true;
  return filter;
}

/**
 * Whether a photo's keywords count toward the public vocabulary. Every count
 * adjustment routes through this so the rule is applied consistently.
 */
function isCounted(doc: Pick<PhotoDoc, 'status' | 'hidden'>): boolean {
  return doc.status === 'ready' && !doc.hidden;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are UUIDs dmbk generates; anything else cannot match. */
export function isValidPhotoId(id: string): boolean {
  return UUID_RE.test(id);
}

export class PhotoNotFoundError extends Error {
  constructor(id: string) {
    super(`No photo with id: ${id}`);
    this.name = 'PhotoNotFoundError';
  }
}

export const MAX_TITLE_LENGTH = 200;

/** Trimmed; whitespace-only becomes no title; over-long titles are rejected. */
export function normalizeTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new InvalidInputError(
      `Title is ${trimmed.length} characters, over the ${MAX_TITLE_LENGTH} character limit.`,
    );
  }
  return trimmed;
}

export async function listPhotos(
  options: { keywords?: readonly string[] | null; scope: PhotoScope } & PageArgs,
): Promise<Page<PhotoDoc>> {
  // Filter keywords get the same normalization as stored ones, so
  // "Black and White" matches the slug `black-and-white`.
  const { slugs } = normalizeKeywords(options.keywords ?? []);

  const base = scopeFilter(options.scope);
  if (slugs.length) base.keywords = { $all: slugs };

  return paginate(options, base, (filter, limit) =>
    PhotoModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean<PhotoDoc[]>().exec(),
  );
}

/**
 * Photos by id within a scope, in input order. A photo outside the scope is
 * null — indistinguishable from one that does not exist, so hiding cannot be
 * probed by guessing identifiers.
 */
export async function loadPhotos(ids: readonly string[], scope: PhotoScope): Promise<(PhotoDoc | null)[]> {
  const valid = ids.filter(isValidPhotoId);
  if (valid.length === 0) return ids.map(() => null);
  const docs = await PhotoModel.find({ _id: { $in: valid }, ...scopeFilter(scope) })
    .lean<PhotoDoc[]>()
    .exec();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.map((id) => byId.get(id) ?? null);
}

/** The vocabulary, count descending then slug ascending. Counts already exclude hidden photos. */
export async function listKeywords(): Promise<KeywordDoc[]> {
  return KeywordModel.find({ count: { $gt: 0 } })
    .sort({ count: -1, _id: 1 })
    .lean<KeywordDoc[]>()
    .exec();
}

async function requirePhoto(id: string): Promise<PhotoDoc> {
  if (!isValidPhotoId(id)) throw new PhotoNotFoundError(id);
  const doc = await PhotoModel.findById(id).lean<PhotoDoc>().exec();
  if (!doc) throw new PhotoNotFoundError(id);
  return doc;
}

/**
 * Replace title, keywords, or both. Supplied fields are replaced wholesale;
 * `undefined` leaves a field untouched, `null` title clears it. Never alters
 * stored bytes or dimensions.
 */
export async function updatePhoto(input: {
  id: string;
  title?: string | null;
  keywords?: readonly string[] | null;
}): Promise<PhotoDoc> {
  const existing = await requirePhoto(input.id);

  const changes: Partial<PhotoDoc> = { updatedAt: new Date().toISOString() };
  if (input.title !== undefined) changes.title = normalizeTitle(input.title);

  let labels: Map<string, string> | undefined;
  if (input.keywords != null) {
    const normalized = normalizeKeywords(input.keywords);
    changes.keywords = normalized.slugs;
    labels = normalized.labels;
  }

  await PhotoModel.updateOne({ _id: input.id }, { $set: changes });

  // Labels are captured whenever a human supplies them, whatever the state.
  if (labels) await registerKeywordLabels(labels);
  if (changes.keywords && isCounted(existing)) {
    await applyKeywordDelta(existing.keywords, changes.keywords, labels);
  }

  return requirePhoto(input.id);
}

/**
 * Hide or unhide. Un-publishing, not deleting. Idempotent — setting the state
 * it is already in changes nothing, including keyword counts.
 */
export async function setPhotoHidden(id: string, hidden: boolean): Promise<PhotoDoc> {
  const existing = await requirePhoto(id);
  if (existing.hidden === hidden) return existing;

  await PhotoModel.updateOne({ _id: id }, { $set: { hidden, updatedAt: new Date().toISOString() } });

  // Crossing into or out of public view moves the same counts that finalizing and deleting move.
  const wasCounted = isCounted(existing);
  const nowCounted = isCounted({ status: existing.status, hidden });
  if (wasCounted !== nowCounted) {
    await applyKeywordDelta(wasCounted ? existing.keywords : [], nowCounted ? existing.keywords : []);
  }

  return requirePhoto(id);
}

// ---------------------------------------------------------------------------
// Upload lifecycle — ported from dmbk's `createPendingPhoto`, `promoteToReady`,
// `markPhotoFailed`, and `deletePhoto`. Both apps finalize and delete each
// other's photos, so the document shape and count rules must stay identical.

/** The record behind an upload reservation. Invisible to the public; uncounted. */
export async function createPendingPhoto(input: {
  id: string;
  originalKey: string;
  contentType: string;
  title?: string | null;
  keywords?: readonly string[] | null;
}): Promise<PhotoDoc> {
  const { slugs, labels } = normalizeKeywords(input.keywords ?? []);
  const now = new Date().toISOString();

  const doc: PhotoDoc = {
    _id: input.id,
    title: normalizeTitle(input.title),
    keywords: slugs,
    status: 'pending',
    hidden: false,
    originalKey: input.originalKey,
    displayKey: null,
    gridKey: null,
    thumbKey: null,
    width: null,
    height: null,
    byteSize: null,
    contentType: input.contentType,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    schemaVersion: PHOTO_SCHEMA_VERSION,
  };

  await PhotoModel.create(doc);

  // Capture the human spelling now: by the time this photo goes `ready` only
  // the slugs remain on the document, and the label would be lost.
  await registerKeywordLabels(labels);

  return doc;
}

/** Any status, any visibility. Null for an unknown or malformed id. */
export async function getPhotoDoc(id: string): Promise<PhotoDoc | null> {
  if (!isValidPhotoId(id)) return null;
  return PhotoModel.findById(id).lean<PhotoDoc>().exec();
}

/**
 * Record the derivatives and promote to `ready`. Title and keywords supplied
 * here replace the reservation's; omitted ones keep it.
 */
export async function promoteToReady(input: {
  id: string;
  displayKey: string;
  gridKey: string;
  thumbKey: string;
  width: number;
  height: number;
  byteSize: number;
  contentType: string;
  title?: string | null;
  keywords?: readonly string[] | null;
  replaceTitle: boolean;
  replaceKeywords: boolean;
}): Promise<PhotoDoc> {
  const existing = await requirePhoto(input.id);

  const title = input.replaceTitle ? normalizeTitle(input.title) : existing.title;

  let keywords = existing.keywords;
  let labels: Map<string, string> | undefined;
  if (input.replaceKeywords) {
    const normalized = normalizeKeywords(input.keywords ?? []);
    keywords = normalized.slugs;
    labels = normalized.labels;
  }

  const updated: PhotoDoc = {
    ...existing,
    title,
    keywords,
    status: 'ready',
    displayKey: input.displayKey,
    gridKey: input.gridKey,
    thumbKey: input.thumbKey,
    width: input.width,
    height: input.height,
    byteSize: input.byteSize,
    contentType: input.contentType,
    failureReason: null,
    updatedAt: new Date().toISOString(),
  };

  await PhotoModel.replaceOne({ _id: input.id }, updated);

  // Invisible until now, so every keyword it carries is new to the counts —
  // unless it was hidden before finalizing, in which case it stays uncounted.
  if (isCounted(updated)) await applyKeywordDelta([], keywords, labels);

  return updated;
}

/** Mark a photo `failed`. A photo leaving public view stops being counted. */
export async function markPhotoFailed(id: string, reason: string): Promise<void> {
  const existing = await getPhotoDoc(id);
  if (!existing) return;

  await PhotoModel.updateOne(
    { _id: id },
    { $set: { status: 'failed', failureReason: reason, updatedAt: new Date().toISOString() } },
  );

  if (isCounted(existing)) await applyKeywordDelta(existing.keywords, []);
}

/**
 * Remove the record and its keyword counts, returning the storage keys it
 * held. The caller deletes those objects — record first, so a storage failure
 * leaves orphaned bytes rather than a record pointing at nothing.
 */
export async function deletePhoto(id: string): Promise<{
  originalKey: string;
  displayKey: string | null;
  gridKey: string | null;
  thumbKey: string | null;
}> {
  const existing = await requirePhoto(id);

  await PhotoModel.deleteOne({ _id: id });

  if (isCounted(existing)) await applyKeywordDelta(existing.keywords, []);

  return {
    originalKey: existing.originalKey,
    displayKey: existing.displayKey,
    gridKey: existing.gridKey,
    thumbKey: existing.thumbKey,
  };
}
