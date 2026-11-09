import { builder } from '../builder.js';
import type { ChimeCompositionDoc } from '../../models/chime.js';
import { DEFAULT_INSTRUMENT, INT_FIELDS, MAX_UNITS, type ChimeUnit } from '../../lib/chime/shape.js';
import { cursorFor } from '../../lib/cursor.js';

/*
 * Saved windchime compositions (openspec/specs/chime-compositions). Unit values
 * are the integers windchime's share links use; each field's description gives
 * its range and step. Validation happens in the repository (`lib/chime/shape.ts`),
 * so these input types only describe the shape.
 */

export const ChimeMidiModeEnum = builder.enumType('ChimeMidiMode', {
  values: {
    POLY: { value: 'poly' },
    MONO: { value: 'mono' },
  } as const,
});

export const ChimeInstrumentEnum = builder.enumType('ChimeInstrument', {
  description: 'The instrument a unit is: the tube chime, or the furin bell (one note, its root).',
  values: {
    CHIME: { value: 'chime' },
    FURIN: { value: 'furin' },
  } as const,
});

const range = (field: keyof typeof INT_FIELDS, what: string) =>
  `${what}, ${INT_FIELDS[field][0]}–${INT_FIELDS[field][1]}.`;

const DESCRIPTIONS = {
  volume: range('volume', 'VOLUME in percent'),
  tubes: range('tubes', 'Tube count'),
  wind: range('wind', 'WIND in percent'),
  decay: range('decay', 'DECAY in tenths of a second'),
  cutoff: range('cutoff', 'The FREQUENCY slider × 1000'),
  resonance: range('resonance', 'RESONANCE × 10'),
  root: range('root', 'Root MIDI note'),
  channel: range('channel', 'MIDI channel'),
  x: range('x', 'Horizontal offset from the page center, in CSS px'),
  y: range('y', 'Vertical offset from the page center, in CSS px'),
  rank: range('rank', 'Stacking order among the units, 0 at the back'),
  scale: "A scale name from windchime's catalog.",
  voice: "A voice id from windchime's catalog (`v<i>` built-in, `s0:<p>` GM preset); null for the default.",
} as const;

export const ChimeUnitRef = builder.objectRef<ChimeUnit>('ChimeUnit').implement({
  description: 'One chime of a saved composition.',
  fields: (t) => ({
    volume: t.exposeInt('volume', { description: DESCRIPTIONS.volume }),
    tubes: t.exposeInt('tubes', { description: DESCRIPTIONS.tubes }),
    wind: t.exposeInt('wind', { description: DESCRIPTIONS.wind }),
    decay: t.exposeInt('decay', { description: DESCRIPTIONS.decay }),
    cutoff: t.exposeInt('cutoff', { description: DESCRIPTIONS.cutoff }),
    resonance: t.exposeInt('resonance', { description: DESCRIPTIONS.resonance }),
    root: t.exposeInt('root', { description: DESCRIPTIONS.root }),
    scale: t.exposeString('scale', { description: DESCRIPTIONS.scale }),
    voice: t.exposeString('voice', { nullable: true, description: DESCRIPTIONS.voice }),
    channel: t.exposeInt('channel', { description: DESCRIPTIONS.channel }),
    midiMode: t.field({ type: ChimeMidiModeEnum, resolve: (u) => u.midiMode }),
    notes: t.exposeBoolean('notes', { description: 'Whether the tube-notes drawer is shown.' }),
    x: t.exposeInt('x', { description: DESCRIPTIONS.x }),
    y: t.exposeInt('y', { description: DESCRIPTIONS.y }),
    rank: t.exposeInt('rank', { description: DESCRIPTIONS.rank }),
    instrument: t.field({
      type: ChimeInstrumentEnum,
      description: 'CHIME for units saved before instruments existed.',
      resolve: (u) => u.instrument ?? DEFAULT_INSTRUMENT,
    }),
  }),
});

export const ChimeUnitInputRef = builder.inputType('ChimeUnitInput', {
  description: 'One chime to save. Every field is required except `voice` and `instrument`.',
  fields: (t) => ({
    volume: t.int({ required: true, description: DESCRIPTIONS.volume }),
    tubes: t.int({ required: true, description: DESCRIPTIONS.tubes }),
    wind: t.int({ required: true, description: DESCRIPTIONS.wind }),
    decay: t.int({ required: true, description: DESCRIPTIONS.decay }),
    cutoff: t.int({ required: true, description: DESCRIPTIONS.cutoff }),
    resonance: t.int({ required: true, description: DESCRIPTIONS.resonance }),
    root: t.int({ required: true, description: DESCRIPTIONS.root }),
    scale: t.string({ required: true, description: DESCRIPTIONS.scale }),
    voice: t.string({ description: `${DESCRIPTIONS.voice} Omitted means null.` }),
    channel: t.int({ required: true, description: DESCRIPTIONS.channel }),
    midiMode: t.field({ type: ChimeMidiModeEnum, required: true }),
    notes: t.boolean({ required: true }),
    x: t.int({ required: true, description: DESCRIPTIONS.x }),
    y: t.int({ required: true, description: DESCRIPTIONS.y }),
    rank: t.int({ required: true, description: DESCRIPTIONS.rank }),
    instrument: t.field({ type: ChimeInstrumentEnum, description: 'Omitted means CHIME.' }),
  }),
});

export const ChimeCompositionRef = builder.objectRef<ChimeCompositionDoc>('ChimeComposition');

builder.node(ChimeCompositionRef, {
  description: `A windchime composition saved anonymously: 1–${MAX_UNITS} chimes. Hidden ones are visible to admins only.`,
  id: { resolve: (c) => c._id },
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'fingerprint' in value,
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.compositionLoader.load(id))),
  fields: (t) => ({
    title: t.exposeString('title', { description: 'Generated by the API from the units: ensemble, key and instrument.' }),
    createdAt: t.exposeString('createdAt', { description: 'ISO-8601.' }),
    unitCount: t.int({ resolve: (c) => c.units.length }),
    units: t.field({ type: [ChimeUnitRef], description: 'In page order.', resolve: (c) => c.units }),
    hidden: t.boolean({
      nullable: true,
      description: 'Admin only.',
      authScopes: { admin: true },
      unauthorizedResolver: () => null,
      resolve: (c) => c.hidden,
    }),
  }),
});

/** An edge outside any connection, so a client can `@prependEdge` a saved composition. */
export const ChimeCompositionEdgeRef = builder.objectRef<ChimeCompositionDoc>('DmbkSoundChimeCompositionEdge').implement({
  description: 'A composition with its cursor in the `dmbkSoundChimeCompositions` ordering.',
  fields: (t) => ({
    cursor: t.string({ resolve: (c) => cursorFor(c) }),
    node: t.field({ type: ChimeCompositionRef, resolve: (c) => c }),
  }),
});
