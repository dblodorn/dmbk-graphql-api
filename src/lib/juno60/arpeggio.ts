import { InvalidInputError } from '../cursor.js';
import { voiceJsonSchema } from './shape.js';

/*
 * A Juno-60 patch's arpeggiator settings (openspec/specs/juno60-voices): a section of their own beside the 42 patch
 * bytes, never inside them, the same shape as `readArpeggio` in @dblodorn/roland-juno60-engine. The hardware never
 * stored them; the juno60 editor keeps them with a patch so windchime arpeggiates it the same way. A patch without
 * them plays with the arpeggiator off, so settings equal to that default are stored as none.
 */

export const ARPEGGIO_MODES = ['UP', 'DOWN', 'UP_DOWN'] as const;
export type ArpeggioMode = (typeof ARPEGGIO_MODES)[number];

export interface Arpeggio {
  version: 1;
  on: boolean;
  mode: ArpeggioMode;
  range: 1 | 2 | 3;
  rate: number;
}

const DEFAULT: Arpeggio = { version: 1, on: false, mode: 'UP', range: 1, rate: 64 };

/** The settings to store, or undefined for none (absent, or the default). Throws `InvalidInputError` naming the field. */
export function checkArpeggio(input: Arpeggio | null | undefined): Arpeggio | undefined {
  if (input == null) return undefined;
  const { version, on, mode, range, rate } = input;
  if (version !== 1) throw new InvalidInputError(`arpeggio.version: must be 1, got ${version}.`);
  if (typeof on !== 'boolean') throw new InvalidInputError('arpeggio.on: must be true or false.');
  if (!ARPEGGIO_MODES.includes(mode)) throw new InvalidInputError(`arpeggio.mode: must be ${ARPEGGIO_MODES.join(', ')}.`);
  if (range !== 1 && range !== 2 && range !== 3) throw new InvalidInputError(`arpeggio.range: must be 1, 2 or 3, got ${range}.`);
  if (!Number.isInteger(rate) || rate < 0 || rate > 127) throw new InvalidInputError(`arpeggio.rate: must be a whole number from 0 to 127, got ${rate}.`);
  const a: Arpeggio = { version: 1, on, mode, range, rate };
  return a.on === DEFAULT.on && a.mode === DEFAULT.mode && a.range === DEFAULT.range && a.rate === DEFAULT.rate ? undefined : a;
}

/** The collection's validator: every synth's voice fields, plus the optional `arpeggio`. */
export function juno60JsonSchema(): Record<string, unknown> {
  const schema = voiceJsonSchema();
  return {
    ...schema,
    properties: {
      ...(schema.properties as Record<string, unknown>),
      arpeggio: {
        bsonType: 'object',
        additionalProperties: false,
        required: ['version', 'on', 'mode', 'range', 'rate'],
        properties: {
          version: { enum: [1] },
          on: { bsonType: 'bool' },
          mode: { enum: [...ARPEGGIO_MODES] },
          range: { enum: [1, 2, 3] },
          rate: { bsonType: 'int', minimum: 0, maximum: 127 },
        },
      },
    },
  };
}
