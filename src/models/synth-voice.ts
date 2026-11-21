import { Schema } from 'mongoose';
import { soundDb } from '../db/mongoose.js';

/*
 * One saved voice of an emulated synth (vz10m's VZ-10M voices, dx7's DX7 voices), each synth in its own
 * `dmbk-sound` collection, which this API owns and only it writes. Every synth's documents have this shape; the
 * collection's `$jsonSchema` validator (`lib/synth-voices/shape.ts`, installed by the synth's collection script) is
 * the real schema, and this model only mirrors it. Same conventions as the rest of `dmbk-sound`: string `_id`s,
 * ISO-8601 strings, no `__v`.
 */

export interface SynthVoiceDoc {
  _id: string;
  schemaVersion: 1;
  /** Read from the bytes, never sent by the client. */
  name: string;
  /** The voice bytes, base64, in the synth's own format. */
  data: string;
  /** SHA-256 of the bytes; unique per creator. */
  fingerprint: string;
  /** SHA-256 of the saving browser's device key; never exposed. */
  creatorHash: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export function synthVoiceModel(modelName: string, collection: string) {
  const schema = new Schema<SynthVoiceDoc>(
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
    { versionKey: false, timestamps: false, strict: true, collection },
  );
  return soundDb().model<SynthVoiceDoc>(modelName, schema);
}
