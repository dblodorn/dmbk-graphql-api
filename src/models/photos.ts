import { Schema } from 'mongoose';
import { photosDb } from '../db/mongoose.js';

/*
 * Documents in `dmbk-photos`, written by the dmbk app (src/server/api/db.ts
 * there is the source of truth). They are deliberately self-describing: string
 * `_id`s, ISO-8601 strings rather than BSON dates, and storage *keys* rather
 * than URLs. These schemas mirror that shape exactly — no `__v`, no Mongoose
 * timestamps, explicit collection names — so a document this API writes is
 * indistinguishable from one dmbk writes.
 */

const docOptions = { versionKey: false, timestamps: false, strict: true } as const;

export type PhotoStatus = 'pending' | 'ready' | 'failed';

export interface PhotoDoc {
  _id: string;
  title: string | null;
  keywords: string[];
  status: PhotoStatus;
  /** Un-published rather than deleted; orthogonal to `status`. */
  hidden: boolean;
  /** Private. Never exposed through the API. */
  originalKey: string;
  displayKey: string | null;
  /** Null on records finalized before the grid variant existed — absent, not broken. */
  gridKey: string | null;
  thumbKey: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  contentType: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
}

/** Version this API understands. dmbk bumps it on shape changes (3 added gridKey). */
export const PHOTO_SCHEMA_VERSION = 3;

/** One vocabulary entry. `_id` is the normalized slug. */
export interface KeywordDoc {
  _id: string;
  label: string;
  /** Number of ready, visible photos carrying this slug. Maintained incrementally. */
  count: number;
}

const photoSchema = new Schema<PhotoDoc>(
  {
    _id: { type: String, required: true },
    title: { type: String, default: null },
    keywords: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'ready', 'failed'], required: true },
    hidden: { type: Boolean, required: true },
    originalKey: { type: String, required: true },
    displayKey: { type: String, default: null },
    gridKey: { type: String, default: null },
    thumbKey: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    byteSize: { type: Number, default: null },
    contentType: { type: String, default: null },
    failureReason: { type: String, default: null },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
  },
  { ...docOptions, collection: 'photos' },
);

const keywordSchema = new Schema<KeywordDoc>(
  {
    _id: { type: String, required: true },
    label: { type: String, required: true },
    count: { type: Number, required: true },
  },
  { ...docOptions, collection: 'keywords' },
);

export const PhotoModel = photosDb().model<PhotoDoc>('Photo', photoSchema);
export const KeywordModel = photosDb().model<KeywordDoc>('Keyword', keywordSchema);
