import { Schema } from 'mongoose';
import { soundDb } from '../db/mongoose.js';
import type { ChimeUnit } from '../lib/chime/shape.js';

/*
 * Saved windchime compositions in `dmbk-sound.chime_compositions`, which this
 * API owns and only it writes (openspec/specs/chime-compositions). The
 * collection's `$jsonSchema` validator (`lib/chime/shape.ts`, installed by
 * `scripts/chime-compositions-collection.ts`) is the real schema; this model
 * only mirrors it. Same conventions as the rest of `dmbk-sound`: string `_id`s,
 * ISO-8601 strings, no `__v`.
 */

const docOptions = { versionKey: false, timestamps: false, strict: true } as const;

export interface ChimeCompositionDoc {
  _id: string;
  schemaVersion: 1;
  /** Generated from the units (`lib/chime/title.ts`), never client text. */
  title: string;
  units: ChimeUnit[];
  /** SHA-256 of the units (`lib/chime/fingerprint.ts`); unique. */
  fingerprint: string;
  hidden: boolean;
  createdAt: string;
}

const unitSchema = new Schema<ChimeUnit>(
  {
    volume: Number,
    tubes: Number,
    wind: Number,
    decay: Number,
    cutoff: Number,
    resonance: Number,
    root: Number,
    scale: String,
    voice: { type: String, default: null },
    channel: Number,
    midiMode: String,
    notes: Boolean,
    x: Number,
    y: Number,
    rank: Number,
  },
  { _id: false, strict: true },
);

const chimeCompositionSchema = new Schema<ChimeCompositionDoc>(
  {
    _id: { type: String, required: true },
    schemaVersion: { type: Number, required: true },
    title: { type: String, required: true },
    units: { type: [unitSchema], required: true },
    fingerprint: { type: String, required: true },
    hidden: { type: Boolean, required: true },
    createdAt: { type: String, required: true },
  },
  { ...docOptions, collection: 'chime_compositions' },
);

export const ChimeCompositionModel = soundDb().model<ChimeCompositionDoc>('ChimeComposition', chimeCompositionSchema);
