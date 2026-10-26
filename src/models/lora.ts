import { Schema } from 'mongoose';
import { loraDb } from '../db/mongoose.js';

/*
 * Documents in `lora-trainer`. This API writes them through the `loraTrainer…`
 * mutations, and lora-trainer still writes the same shapes directly until it
 * moves onto them, so the two must not drift. String hex `_id`s and ISO-8601
 * `createdAt` strings, with no `__v` or timestamps.
 */

const docOptions = { versionKey: false, timestamps: false, strict: true } as const;

export type LoraStatus = 'pending' | 'completed' | 'failed';

export interface LoraTrainingDoc {
  _id: string;
  requestId: string;
  /** The owning account's user id (`dmbk-accounts`). Missing until backfilled. */
  ownerId?: string;
  /** Pre-accounts owner. Kept as history, no longer exposed or written. */
  walletAddress?: string;
  triggerWord: string;
  steps: number;
  /** Original upload URLs (fal.ai). */
  imageUrls: string[];
  /** Mirrors of `imageUrls` on DO Spaces; empty on older records. */
  imageUrlsSpaces: string[];
  trainingZipUrl: string | null;
  loraWeightsUrl: string | null;
  arenaChannelUrl: string | null;
  arenaChannelTitle: string | null;
  /** Older records may lack it; treat missing as visible, as lora-trainer does. */
  hidden?: boolean;
  status: LoraStatus;
  createdAt: string;
}

export interface GeneratedImageDoc {
  _id: string;
  loraTrainingId: string;
  /** The account that generated it — not necessarily the LoRA's owner. */
  ownerId?: string;
  /** Pre-accounts owner. Kept as history, no longer exposed or written. */
  walletAddress?: string;
  prompt: string;
  /** fal.ai URL. Prefer `cdnUrl` when present. */
  imageUrl: string;
  cdnUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  seed: string | null;
  loraScaleValue: string | null;
  loraScaleName: string | null;
  genWidth: number | null;
  genHeight: number | null;
  hidden?: boolean;
  createdAt: string;
}

const loraTrainingSchema = new Schema<LoraTrainingDoc>(
  {
    _id: { type: String, required: true },
    requestId: { type: String, required: true },
    ownerId: { type: String },
    walletAddress: { type: String },
    triggerWord: { type: String, required: true },
    steps: { type: Number, required: true },
    imageUrls: { type: [String], default: [] },
    imageUrlsSpaces: { type: [String], default: [] },
    trainingZipUrl: { type: String, default: null },
    loraWeightsUrl: { type: String, default: null },
    arenaChannelUrl: { type: String, default: null },
    arenaChannelTitle: { type: String, default: null },
    hidden: { type: Boolean },
    status: { type: String, enum: ['pending', 'completed', 'failed'], required: true },
    createdAt: { type: String, required: true },
  },
  { ...docOptions, collection: 'lora_trainings' },
);

const generatedImageSchema = new Schema<GeneratedImageDoc>(
  {
    _id: { type: String, required: true },
    loraTrainingId: { type: String, required: true },
    ownerId: { type: String },
    walletAddress: { type: String },
    prompt: { type: String, required: true },
    imageUrl: { type: String, required: true },
    cdnUrl: { type: String, default: null },
    imageWidth: { type: Number, default: null },
    imageHeight: { type: Number, default: null },
    seed: { type: String, default: null },
    loraScaleValue: { type: String, default: null },
    loraScaleName: { type: String, default: null },
    genWidth: { type: Number, default: null },
    genHeight: { type: Number, default: null },
    hidden: { type: Boolean },
    createdAt: { type: String, required: true },
  },
  { ...docOptions, collection: 'generated_images' },
);

export const LoraTrainingModel = loraDb().model<LoraTrainingDoc>('LoraTraining', loraTrainingSchema);
export const GeneratedImageModel = loraDb().model<GeneratedImageDoc>('GeneratedImage', generatedImageSchema);
