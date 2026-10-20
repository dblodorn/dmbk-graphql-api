import {
  LoraTrainingModel,
  GeneratedImageModel,
  type LoraTrainingDoc,
  type GeneratedImageDoc,
} from '../../models/lora.js';
import { paginate, type Page, type PageArgs } from '../cursor.js';
import type { Viewer } from '../../auth/token.js';

/*
 * Every lora-trainer query goes through this module, and visibility is decided
 * here only.
 *
 * Public: trainings that are `completed` and not hidden; images that are not
 * hidden. An owner — the wallet in the record's own `walletAddress` — also sees
 * their own hidden or unfinished records. Ownership is per record: any wallet
 * may generate images on any public LoRA, so an image's owner is whoever
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

/** Wallet addresses are compared case-insensitively; stored casing varies. */
export function isOwner(viewer: Viewer | null, doc: { walletAddress: string }): boolean {
  return viewer !== null && viewer.address === doc.walletAddress.toLowerCase();
}

function ownerFilter(address: string): Record<string, unknown> {
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { walletAddress: { $regex: `^${escaped}$`, $options: 'i' } };
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
  return paginate(args, { ...ownerFilter(viewer.address), ...hiddenFilter(visibility) }, (filter, limit) =>
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
  return paginate(args, { ...ownerFilter(viewer.address), ...hiddenFilter(visibility) }, (filter, limit) =>
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
