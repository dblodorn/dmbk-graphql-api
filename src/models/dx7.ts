import { Schema } from 'mongoose';
import { soundDb } from '../db/mongoose.js';
import { synthVoiceModel, type SynthVoiceDoc } from './synth-voice.js';

/*
 * Saved Yamaha DX7 voices in `dmbk-sound.dx7_voices` (openspec/specs/dx7-voices): the 155 unpacked VCED voice
 * bytes, base64. The shape is every synth's (`models/synth-voice.ts`).
 */

export type Dx7VoiceDoc = SynthVoiceDoc;

export const Dx7VoiceModel = synthVoiceModel('Dx7Voice', 'dx7_voices');

/*
 * Saved DX7 banks in `dmbk-sound.dx7_banks` (openspec/specs/dx7-voices, "Banks"): 32 slots like a DX7 ROM or RAM
 * cartridge, each the `_id` of a `dx7_voices` document or null. The validator (`lib/dx7/banks.ts`, installed by
 * `scripts/dx7-banks-collection.ts`) is the real schema.
 */
export interface Dx7BankDoc {
  _id: string;
  schemaVersion: 1;
  /** Shown as given (trimmed), checked like voice names. */
  name: string;
  /** Exactly 32: a dx7_voices `_id` or null. */
  slots: (string | null)[];
  /** SHA-256 of the name and slots; unique per creator. */
  fingerprint: string;
  creatorHash: string;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

const dx7BankSchema = new Schema<Dx7BankDoc>(
  {
    _id: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
    name: { type: String, required: true },
    slots: { type: [{ type: String, default: null }], required: true },
    fingerprint: { type: String, required: true },
    creatorHash: { type: String, required: true },
    hidden: { type: Boolean, required: true },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { versionKey: false, timestamps: false, strict: true, collection: 'dx7_banks' },
);

export const Dx7BankModel = soundDb().model<Dx7BankDoc>('Dx7Bank', dx7BankSchema);
