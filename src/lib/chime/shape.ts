import { z } from 'zod';
import { SCALES, VOICE_IDS } from './catalog.js';

/*
 * The one definition of a saved chime unit (openspec/specs/chime-compositions).
 * Values are integers at the steps windchime's share links use, so range checks
 * are exact and a saved composition round-trips through a link unchanged. Both
 * validators come from this table: the zod schema checks mutation input, and
 * the `$jsonSchema` is what `scripts/chime-compositions-collection.ts` installs
 * on the collection, so the database refuses what the API would.
 */

export const MAX_UNITS = 16;

/** Integer fields and their inclusive ranges. */
export const INT_FIELDS = {
  volume: [0, 100], // percent
  tubes: [2, 8],
  wind: [0, 100], // percent
  decay: [3, 120], // tenths of a second
  cutoff: [0, 1000], // FREQUENCY slider × 1000
  resonance: [5, 180], // × 10
  root: [48, 84], // MIDI note
  channel: [1, 16],
  x: [-32768, 32767],
  y: [-32768, 32767],
  rank: [0, MAX_UNITS - 1], // stacking order
} as const satisfies Record<string, readonly [number, number]>;

export const MIDI_MODES = ['poly', 'mono'] as const;

/** `chime` is the tube chime, `furin` the furin bell. Optional in storage: a unit without it is a tube chime. */
export const INSTRUMENTS = ['chime', 'furin'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

export const DEFAULT_INSTRUMENT: Instrument = 'chime';

/** Every required unit field, in the canonical order the fingerprint hashes them (`instrument` is not one, see fingerprint.ts). */
export const UNIT_FIELDS = [
  'volume', 'tubes', 'wind', 'decay', 'cutoff', 'resonance', 'root',
  'scale', 'voice', 'channel', 'midiMode', 'notes', 'x', 'y', 'rank',
] as const;

export interface ChimeUnit {
  volume: number;
  tubes: number;
  wind: number;
  decay: number;
  cutoff: number;
  resonance: number;
  root: number;
  scale: string;
  voice: string | null;
  channel: number;
  midiMode: (typeof MIDI_MODES)[number];
  notes: boolean;
  x: number;
  y: number;
  rank: number;
  /** Missing on units saved before it existed. */
  instrument?: Instrument;
}

const int = ([min, max]: readonly [number, number]) => z.int().min(min).max(max);

export const UnitInputSchema = z
  .object({
    volume: int(INT_FIELDS.volume),
    tubes: int(INT_FIELDS.tubes),
    wind: int(INT_FIELDS.wind),
    decay: int(INT_FIELDS.decay),
    cutoff: int(INT_FIELDS.cutoff),
    resonance: int(INT_FIELDS.resonance),
    root: int(INT_FIELDS.root),
    scale: z.string().refine((s) => SCALES.includes(s), { message: 'Unknown scale.' }),
    voice: z
      .string()
      .refine((v) => VOICE_IDS.includes(v), { message: 'Unknown voice.' })
      .nullable()
      .default(null),
    channel: int(INT_FIELDS.channel),
    midiMode: z.enum(MIDI_MODES),
    notes: z.boolean(),
    x: int(INT_FIELDS.x),
    y: int(INT_FIELDS.y),
    rank: int(INT_FIELDS.rank),
    instrument: z.enum(INSTRUMENTS).nullish().transform((v) => v ?? DEFAULT_INSTRUMENT), // GraphQL may send null for omitted
  })
  .strict();

export const UnitsInputSchema = z.array(UnitInputSchema).min(1).max(MAX_UNITS);

/** The collection validator: document and unit, every field but `instrument` required, nothing else allowed. */
export function compositionJsonSchema(): Record<string, unknown> {
  const intProps = Object.fromEntries(
    Object.entries(INT_FIELDS).map(([name, [minimum, maximum]]) => [name, { bsonType: 'int', minimum, maximum }]),
  );
  const unit = {
    bsonType: 'object',
    additionalProperties: false,
    required: [...UNIT_FIELDS],
    properties: {
      ...intProps,
      scale: { bsonType: 'string', enum: [...SCALES] },
      voice: { bsonType: ['string', 'null'], enum: [null, ...VOICE_IDS] },
      midiMode: { bsonType: 'string', enum: [...MIDI_MODES] },
      notes: { bsonType: 'bool' },
      // allowed, not required: units stored before it existed stay valid
      instrument: { bsonType: 'string', enum: [...INSTRUMENTS] },
    },
  };
  return {
    bsonType: 'object',
    additionalProperties: false,
    required: ['_id', 'schemaVersion', 'title', 'units', 'fingerprint', 'hidden', 'createdAt'],
    properties: {
      _id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
      schemaVersion: { bsonType: 'int', enum: [1] },
      title: { bsonType: 'string', minLength: 1, maxLength: 40 },
      units: { bsonType: 'array', minItems: 1, maxItems: MAX_UNITS, items: unit },
      fingerprint: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      hidden: { bsonType: 'bool' },
      createdAt: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$' },
    },
  };
}
