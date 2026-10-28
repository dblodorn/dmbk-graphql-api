import {
  LoraTrainingModel,
  GeneratedImageModel,
  type LoraTrainingDoc,
  type GeneratedImageDoc,
} from '../../models/lora.js';
import { InvalidInputError, paginate, type Page, type PageArgs } from '../cursor.js';
import { loraDb } from '../../db/mongoose.js';
import type { Viewer } from '../../auth/viewer.js';
import { isLoraId, newLoraId } from './ids.js';
import { assertHttpsUrl, assertMirrorUrl } from './urls.js';
import { assertModelId, LEGACY_GENERATOR_MODEL, LEGACY_TRAINER_MODEL } from './models.js';

/*
 * Every lora-trainer query goes through this module, and visibility is decided
 * here only.
 *
 * Public: trainings that are `completed` and not hidden; images that are not
 * hidden. An owner — the account named by the record's own `ownerId` — also
 * sees their own hidden or unfinished records. A record without `ownerId`
 * (written by lora-trainer before it moved to accounts, and not yet backfilled
 * by `scripts/backfill-owner-id.ts`) has no owner. Ownership is per record: any
 * account may generate images on any public LoRA, so an image's owner is whoever
 * generated it, not the LoRA's trainer.
 *
 * `hidden` is matched with `$ne: true` rather than `false` because lora-trainer
 * never backfilled it, so older records may lack the field.
 */

export type LoraVisibility = 'visible' | 'hidden' | 'any';

export class LoraNotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`No ${kind} with id: ${id}`);
    this.name = 'LoraNotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function isOwner(viewer: Viewer | null, doc: { ownerId?: string | null }): boolean {
  return viewer !== null && !!doc.ownerId && doc.ownerId === viewer.id;
}

function ownerFilter(viewer: Viewer): Record<string, unknown> {
  return { ownerId: viewer.id };
}

function hiddenFilter(visibility: LoraVisibility): Record<string, unknown> {
  if (visibility === 'visible') return { hidden: { $ne: true } };
  if (visibility === 'hidden') return { hidden: true };
  return {};
}

function isPublicTraining(doc: LoraTrainingDoc): boolean {
  return doc.status === 'completed' && doc.hidden !== true;
}

function isPublicImage(doc: GeneratedImageDoc): boolean {
  return doc.hidden !== true;
}

const newestFirst = { createdAt: -1, _id: -1 } as const;

/** The public listing: completed, visible, newest first. */
export function listPublicTrainings(args: PageArgs): Promise<Page<LoraTrainingDoc>> {
  return paginate(args, { status: 'completed', ...hiddenFilter('visible') }, (filter, limit) =>
    LoraTrainingModel.find(filter).sort(newestFirst).limit(limit).lean<LoraTrainingDoc[]>().exec(),
  );
}

/** One owner's trainings at any status, filtered by visibility. */
export function listOwnTrainings(
  viewer: Viewer,
  visibility: LoraVisibility,
  args: PageArgs,
): Promise<Page<LoraTrainingDoc>> {
  return paginate(args, { ...ownerFilter(viewer), ...hiddenFilter(visibility) }, (filter, limit) =>
    LoraTrainingModel.find(filter).sort(newestFirst).limit(limit).lean<LoraTrainingDoc[]>().exec(),
  );
}

/** Visible images generated from one LoRA. */
export function listImagesForTraining(trainingId: string, args: PageArgs): Promise<Page<GeneratedImageDoc>> {
  return paginate(args, { loraTrainingId: trainingId, ...hiddenFilter('visible') }, (filter, limit) =>
    GeneratedImageModel.find(filter).sort(newestFirst).limit(limit).lean<GeneratedImageDoc[]>().exec(),
  );
}

/** One owner's generated images, filtered by visibility. */
export function listOwnImages(
  viewer: Viewer,
  visibility: LoraVisibility,
  args: PageArgs,
): Promise<Page<GeneratedImageDoc>> {
  return paginate(args, { ...ownerFilter(viewer), ...hiddenFilter(visibility) }, (filter, limit) =>
    GeneratedImageModel.find(filter).sort(newestFirst).limit(limit).lean<GeneratedImageDoc[]>().exec(),
  );
}

/**
 * Trainings by id, in input order. Anything the viewer may not see is null —
 * indistinguishable from a missing record. (lora-trainer's own `getById`
 * returns hidden records to anyone; this deliberately does not.)
 */
export async function loadTrainings(ids: readonly string[], viewer: Viewer | null): Promise<(LoraTrainingDoc | null)[]> {
  const docs = await LoraTrainingModel.find({ _id: { $in: ids } }).lean<LoraTrainingDoc[]>().exec();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.map((id) => {
    const doc = byId.get(id);
    return doc && (isPublicTraining(doc) || isOwner(viewer, doc)) ? doc : null;
  });
}

export async function loadImages(ids: readonly string[], viewer: Viewer | null): Promise<(GeneratedImageDoc | null)[]> {
  const docs = await GeneratedImageModel.find({ _id: { $in: ids } }).lean<GeneratedImageDoc[]>().exec();
  const byId = new Map(docs.map((d) => [d._id, d]));
  return ids.map((id) => {
    const doc = byId.get(id);
    return doc && (isPublicImage(doc) || isOwner(viewer, doc)) ? doc : null;
  });
}

/** Hide or unhide a training. Owner only, matching lora-trainer. */
export async function setTrainingHidden(viewer: Viewer, id: string, hidden: boolean): Promise<LoraTrainingDoc> {
  const doc = await LoraTrainingModel.findById(id).lean<LoraTrainingDoc>().exec();
  if (!doc) throw new LoraNotFoundError('LoRA', id);
  if (!isOwner(viewer, doc)) {
    // A non-owner cannot tell a hidden record from a missing one.
    if (!isPublicTraining(doc)) throw new LoraNotFoundError('LoRA', id);
    throw new ForbiddenError('You are not the owner of this LoRA.');
  }
  await LoraTrainingModel.updateOne({ _id: id }, { $set: { hidden } });
  return { ...doc, hidden };
}

/** Hide or unhide a generated image. Owner (the generating wallet) only. */
export async function setImageHidden(viewer: Viewer, id: string, hidden: boolean): Promise<GeneratedImageDoc> {
  const doc = await GeneratedImageModel.findById(id).lean<GeneratedImageDoc>().exec();
  if (!doc) throw new LoraNotFoundError('image', id);
  if (!isOwner(viewer, doc)) {
    if (!isPublicImage(doc)) throw new LoraNotFoundError('image', id);
    throw new ForbiddenError('You are not the owner of this image.');
  }
  await GeneratedImageModel.updateOne({ _id: id }, { $set: { hidden } });
  return { ...doc, hidden };
}

// ---------------------------------------------------------------------------
// Writes from lora-trainer's fal.ai work. lora-trainer runs the training and
// generation and mirrors the files to Spaces; these record what it produced.
// Documents are written in exactly the shape lora-trainer wrote them itself
// (its `createPendingLora`, `lora.complete` and `generate.images`), so either
// app version can run against the data.

export interface CreateTrainingInput {
  requestId: string;
  triggerWord: string;
  steps: number;
  imageUrls: string[];
  arenaChannelUrl?: string | null;
  arenaChannelTitle?: string | null;
  /** fal.ai endpoint id. Omitted: the legacy FLUX trainer. */
  trainerModel?: string | null;
}

export interface TrainingAssetsInput {
  trainingZipUrl?: string | null;
  imageUrlsSpaces?: string[] | null;
}

export interface CompleteTrainingInput {
  loraWeightsUrl: string;
  imageUrlsSpaces?: string[] | null;
}

export interface RecordImageInput {
  id: string;
  prompt: string;
  imageUrl: string;
  cdnUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  seed?: string | null;
  loraScaleValue?: string | null;
  loraScaleName?: string | null;
  genWidth?: number | null;
  genHeight?: number | null;
}

/** lora-trainer's own limits on `trainLora`. */
const MAX_SOURCE_IMAGES = 20;
const MAX_IMAGES_PER_BATCH = 8;
const MAX_PROMPT_LENGTH = 1000;

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;
}

function assertLength(value: string, field: string, min: number, max: number): void {
  if (value.length < min || value.length > max) {
    throw new InvalidInputError(`${field} must be ${min}–${max} characters.`);
  }
}

function assertMirrorUrls(urls: string[], field: string): void {
  if (urls.length > MAX_SOURCE_IMAGES) throw new InvalidInputError(`${field} takes at most ${MAX_SOURCE_IMAGES} URLs.`);
  urls.forEach((url, i) => assertMirrorUrl(url, `${field}[${i}]`));
}

function assertOptionalSize(value: number | null | undefined, field: string): void {
  if (value != null && (!Number.isInteger(value) || value < 1)) {
    throw new InvalidInputError(`${field} must be a positive integer.`);
  }
}

/**
 * A training the viewer owns, for a write. Same refusals as `setTrainingHidden`:
 * a non-owner can't tell a training they can't see from a missing one.
 */
async function ownTrainingForWrite(viewer: Viewer, id: string): Promise<LoraTrainingDoc> {
  const doc = await LoraTrainingModel.findById(id).lean<LoraTrainingDoc>().exec();
  if (!doc) throw new LoraNotFoundError('LoRA', id);
  if (!isOwner(viewer, doc)) {
    if (!isPublicTraining(doc)) throw new LoraNotFoundError('LoRA', id);
    throw new ForbiddenError('You are not the owner of this LoRA.');
  }
  return doc;
}

/** Record a pending training the viewer has just queued on fal.ai. */
export async function createTraining(viewer: Viewer, input: CreateTrainingInput): Promise<LoraTrainingDoc> {
  assertLength(input.requestId, 'requestId', 1, 200);
  assertLength(input.triggerWord, 'triggerWord', 1, 50);
  if (!Number.isInteger(input.steps) || input.steps < 100 || input.steps > 2000) {
    throw new InvalidInputError('steps must be an integer from 100 to 2000.');
  }
  if (input.imageUrls.length < 1 || input.imageUrls.length > MAX_SOURCE_IMAGES) {
    throw new InvalidInputError(`imageUrls takes 1–${MAX_SOURCE_IMAGES} URLs.`);
  }
  input.imageUrls.forEach((url, i) => assertHttpsUrl(url, `imageUrls[${i}]`));
  if (input.arenaChannelUrl != null) assertHttpsUrl(input.arenaChannelUrl, 'arenaChannelUrl');
  if (input.arenaChannelTitle != null) assertLength(input.arenaChannelTitle, 'arenaChannelTitle', 0, 200);
  if (input.trainerModel != null) assertModelId(input.trainerModel, 'trainerModel');

  const doc: LoraTrainingDoc = {
    _id: newLoraId(),
    requestId: input.requestId,
    ownerId: viewer.id,
    triggerWord: input.triggerWord,
    steps: input.steps,
    trainerModel: input.trainerModel ?? LEGACY_TRAINER_MODEL,
    imageUrls: input.imageUrls,
    imageUrlsSpaces: [],
    trainingZipUrl: null,
    loraWeightsUrl: null,
    arenaChannelUrl: input.arenaChannelUrl ?? null,
    arenaChannelTitle: input.arenaChannelTitle ?? null,
    hidden: false,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  try {
    // The unique `requestId` index is the only duplicate check, so there's no race.
    await LoraTrainingModel.create(doc);
  } catch (error) {
    if (isDuplicateKey(error)) throw new InvalidInputError('A training already exists for this request id.');
    throw error;
  }
  return doc;
}

/** Attach the training zip and/or the Spaces mirrors of the source images. Owner only. */
export async function setTrainingAssets(viewer: Viewer, id: string, input: TrainingAssetsInput): Promise<LoraTrainingDoc> {
  const set: Partial<LoraTrainingDoc> = {};
  if (input.trainingZipUrl != null) {
    assertMirrorUrl(input.trainingZipUrl, 'trainingZipUrl');
    set.trainingZipUrl = input.trainingZipUrl;
  }
  if (input.imageUrlsSpaces != null) {
    assertMirrorUrls(input.imageUrlsSpaces, 'imageUrlsSpaces');
    set.imageUrlsSpaces = input.imageUrlsSpaces;
  }

  const doc = await ownTrainingForWrite(viewer, id);
  if (Object.keys(set).length > 0) await LoraTrainingModel.updateOne({ _id: id }, { $set: set });
  return { ...doc, ...set };
}

/**
 * Mark a training completed. Owner only. Completing one that is already
 * completed changes nothing: the update only matches an unfinished training,
 * so a concurrent or repeated call leaves the first completion in place.
 */
export async function completeTraining(viewer: Viewer, id: string, input: CompleteTrainingInput): Promise<LoraTrainingDoc> {
  assertHttpsUrl(input.loraWeightsUrl, 'loraWeightsUrl');
  if (input.imageUrlsSpaces != null) assertMirrorUrls(input.imageUrlsSpaces, 'imageUrlsSpaces');

  const doc = await ownTrainingForWrite(viewer, id);
  const set: Partial<LoraTrainingDoc> = { status: 'completed', loraWeightsUrl: input.loraWeightsUrl };
  if (input.imageUrlsSpaces?.length) set.imageUrlsSpaces = input.imageUrlsSpaces;

  const { modifiedCount } = await LoraTrainingModel.updateOne(
    { _id: id, status: { $ne: 'completed' } },
    { $set: set },
  );
  if (modifiedCount === 0) {
    return (await LoraTrainingModel.findById(id).lean<LoraTrainingDoc>().exec()) ?? doc;
  }
  return { ...doc, ...set };
}

/** The viewer's own training for a fal.ai request id, at any status, or null. */
export function findOwnTrainingByRequestId(viewer: Viewer, requestId: string): Promise<LoraTrainingDoc | null> {
  return LoraTrainingModel.findOne({ requestId, ...ownerFilter(viewer) }).lean<LoraTrainingDoc>().exec();
}

/**
 * Record a batch of images the viewer generated with one LoRA, all or nothing.
 * The LoRA must be completed and visible to the viewer. Ids come from the
 * client, which builds each image's Spaces key from its id before recording.
 * One fal.ai call makes the whole batch, so its model is given once.
 */
export async function recordImages(
  viewer: Viewer,
  loraTrainingId: string,
  images: RecordImageInput[],
  generatorModel?: string | null,
): Promise<{ training: LoraTrainingDoc; images: GeneratedImageDoc[] }> {
  if (generatorModel != null) assertModelId(generatorModel, 'generatorModel');
  if (images.length < 1 || images.length > MAX_IMAGES_PER_BATCH) {
    throw new InvalidInputError(`images takes 1–${MAX_IMAGES_PER_BATCH} images.`);
  }
  const ids = new Set<string>();
  images.forEach((image, i) => {
    if (!isLoraId(image.id)) throw new InvalidInputError(`images[${i}].id must be 32 lowercase hex characters.`);
    if (ids.has(image.id)) throw new InvalidInputError(`images[${i}].id is repeated in the batch.`);
    ids.add(image.id);
    assertLength(image.prompt, `images[${i}].prompt`, 1, MAX_PROMPT_LENGTH);
    assertHttpsUrl(image.imageUrl, `images[${i}].imageUrl`);
    if (image.cdnUrl != null) assertMirrorUrl(image.cdnUrl, `images[${i}].cdnUrl`);
    for (const field of ['imageWidth', 'imageHeight', 'genWidth', 'genHeight'] as const) {
      assertOptionalSize(image[field], `images[${i}].${field}`);
    }
  });

  const training = await LoraTrainingModel.findById(loraTrainingId).lean<LoraTrainingDoc>().exec();
  if (!training || !(isPublicTraining(training) || isOwner(viewer, training))) {
    throw new LoraNotFoundError('LoRA', loraTrainingId);
  }
  if (training.status !== 'completed') throw new InvalidInputError('This LoRA has not finished training.');

  if (await GeneratedImageModel.exists({ _id: { $in: [...ids] } })) {
    throw new InvalidInputError('An image id in this batch is already used.');
  }

  const createdAt = new Date().toISOString();
  const docs: GeneratedImageDoc[] = images.map((image) => ({
    _id: image.id,
    loraTrainingId,
    ownerId: viewer.id,
    prompt: image.prompt,
    imageUrl: image.imageUrl,
    cdnUrl: image.cdnUrl ?? null,
    imageWidth: image.imageWidth ?? null,
    imageHeight: image.imageHeight ?? null,
    seed: image.seed ?? null,
    loraScaleValue: image.loraScaleValue ?? null,
    loraScaleName: image.loraScaleName ?? null,
    genWidth: image.genWidth ?? null,
    genHeight: image.genHeight ?? null,
    generatorModel: generatorModel ?? LEGACY_GENERATOR_MODEL,
    hidden: false,
    createdAt,
  }));

  try {
    // A transaction, so an id that races past the check above leaves nothing behind.
    await loraDb().transaction(async (session) => {
      await GeneratedImageModel.insertMany(docs, { session });
    });
  } catch (error) {
    if (isDuplicateKey(error)) throw new InvalidInputError('An image id in this batch is already used.');
    throw error;
  }
  return { training, images: docs };
}

/**
 * Random image URLs for the public slideshow: visible generated images whose
 * LoRA is completed and visible, plus the source images of a few completed,
 * visible trainings (their Spaces mirrors where they exist). Unlike
 * lora-trainer's original, nothing hidden or unfinished contributes.
 */
export async function slideshowImages(count: number): Promise<{ url: string }[]> {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new InvalidInputError('count must be from 1 to 20.');
  }

  const [generated, trainings] = await Promise.all([
    GeneratedImageModel.aggregate<{ url: string }>([
      { $match: hiddenFilter('visible') },
      // Oversampled: some are dropped below when their LoRA isn't public.
      { $sample: { size: count * 2 } },
      { $lookup: { from: LoraTrainingModel.collection.name, localField: 'loraTrainingId', foreignField: '_id', as: 'training' } },
      { $match: { 'training.status': 'completed', 'training.hidden': { $ne: true } } },
      { $project: { _id: 0, url: { $ifNull: ['$cdnUrl', '$imageUrl'] } } },
    ]).exec(),
    LoraTrainingModel.aggregate<Pick<LoraTrainingDoc, 'imageUrls' | 'imageUrlsSpaces'>>([
      { $match: { status: 'completed', ...hiddenFilter('visible') } },
      { $sample: { size: 5 } },
      { $project: { _id: 0, imageUrls: 1, imageUrlsSpaces: 1 } },
    ]).exec(),
  ]);

  const urls = new Set(generated.map((g) => g.url));
  for (const t of trainings) {
    for (const url of t.imageUrlsSpaces?.length ? t.imageUrlsSpaces : (t.imageUrls ?? [])) urls.add(url);
  }

  const shuffled = [...urls];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count).map((url) => ({ url }));
}
