import { Schema } from 'mongoose';
import { soundDb } from '../db/mongoose.js';

/*
 * Saved VZ-10M voices in `dmbk-sound.vz_voices`, which this API owns and only
 * it writes (openspec/specs/vz-voices). The collection's `$jsonSchema`
 * validator (`lib/vz/shape.ts`, installed by `scripts/vz-voices-collection.ts`)
 * is the real schema; this model only mirrors it. Same conventions as the rest
 * of `dmbk-sound`: string `_id`s, ISO-8601 strings, no `__v`.
 */

export interface VzVoiceDoc {
  _id: string;
  schemaVersion: 1;
  /** Read from the bytes (`lib/vz/shape.ts#voiceName`). */
  name: string;
  /** The 336 decoded voice bytes, base64. */
  data: string;
  /** SHA-256 of the bytes; unique per creator. */
  fingerprint: string;
  /** SHA-256 of the saving browser's device key; never exposed. */
  creatorHash: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

const vzVoiceSchema = new Schema<VzVoiceDoc>(
  {
    _id: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
    name: { type: String }, // may be '' (an all-spaces name); the validator requires it
    data: { type: String, required: true },
    fingerprint: { type: String, required: true },
    creatorHash: { type: String, required: true },
    hidden: { type: Boolean, required: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false, timestamps: false, strict: true, collection: 'vz_voices' },
);

export const VzVoiceModel = soundDb().model<VzVoiceDoc>('VzVoice', vzVoiceSchema);
