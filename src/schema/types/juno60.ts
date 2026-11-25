import { builder } from '../builder.js';
import type { Juno60VoiceDoc } from '../../models/juno60.js';
import { DATA_LENGTH, VOICE_BYTES } from '../../lib/juno60/shape.js';
import { isCreator } from '../../lib/juno60/repository.js';
import { cursorFor } from '../../lib/cursor.js';
import { SynthPatchRef } from './vz.js';
import { ARPEGGIO_MODES, type Arpeggio } from '../../lib/juno60/arpeggio.js';

export const Juno60ArpeggioModeEnum = builder.enumType('Juno60ArpeggioMode', {
  description: 'The arpeggio\'s direction: UP, DOWN, or UP_DOWN (up then down, the top and bottom notes not repeated).',
  values: Object.fromEntries(ARPEGGIO_MODES.map((m) => [m, { value: m }])) as Record<(typeof ARPEGGIO_MODES)[number], { value: (typeof ARPEGGIO_MODES)[number] }>,
});

export const Juno60ArpeggioRef = builder.objectRef<Arpeggio>('Juno60Arpeggio').implement({
  description: "A patch's arpeggiator settings, kept beside its 42 bytes (never inside them). HOLD is a performance switch and isn't saved.",
  fields: (t) => ({
    version: t.exposeInt('version', { description: 'The settings version: 1.' }),
    on: t.exposeBoolean('on'),
    mode: t.field({ type: Juno60ArpeggioModeEnum, resolve: (a) => a.mode }),
    range: t.exposeInt('range', { description: 'Octaves: 1, 2 or 3.' }),
    rate: t.exposeInt('rate', { description: '0–127, read on the panel\'s 0–10 scale.' }),
  }),
});

export const Juno60ArpeggioInputRef = builder.inputType('Juno60ArpeggioInput', {
  description: 'Arpeggiator settings to keep with a patch. Settings equal to the default (off, UP, range 1, rate 64) are stored as none.',
  fields: (t) => ({
    version: t.int({ required: true, description: '1.' }),
    on: t.boolean({ required: true }),
    mode: t.field({ type: Juno60ArpeggioModeEnum, required: true }),
    range: t.int({ required: true, description: 'Octaves: 1, 2 or 3.' }),
    rate: t.int({ required: true, description: '0–127.' }),
  }),
});

/*
 * Saved Roland Juno-60 patches (openspec/specs/juno60-voices), saved anonymously by the juno60 editor
 * (juno60.dmbk.io). A patch is its 42 bytes in the editor's own layout, base64; the editor decodes everything else
 * from them. Implements SynthPatch, so windchime fetches one the way it fetches a VZ or DX7 voice.
 */

export const Juno60VoiceRef = builder.objectRef<Juno60VoiceDoc>('Juno60Voice');

builder.node(Juno60VoiceRef, {
  description: 'A Roland Juno-60 patch saved anonymously. Hidden ones are visible to admins only.',
  interfaces: [SynthPatchRef],
  id: { resolve: (v) => v._id },
  // every synth's voice documents have the same fields, so the data's length tells a Juno-60 patch from another synth's
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'creatorHash' in value && (value as Juno60VoiceDoc).data.length === DATA_LENGTH,
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.juno60VoiceLoader.load(id))),
  fields: (t) => ({
    name: t.exposeString('name', { description: "The patch's name, read from the bytes; may be empty." }),
    data: t.exposeString('data', { description: `The ${VOICE_BYTES} patch bytes (the juno60 editor's layout) as base64 (${DATA_LENGTH} characters).` }),
    arpeggio: t.field({
      type: Juno60ArpeggioRef,
      nullable: true,
      description: 'The arpeggiator settings kept with the patch; null means the arpeggiator is off.',
      resolve: (v) => v.arpeggio ?? null,
    }),
    createdAt: t.exposeString('createdAt', { description: 'ISO-8601. The listing is ordered by this.' }),
    updatedAt: t.exposeString('updatedAt', { description: 'ISO-8601. Equals createdAt until the patch is updated.' }),
    yours: t.boolean({
      description: 'Whether this device key saved the patch. The key is never stored, only compared by hash.',
      args: { creatorKey: t.arg.string({ required: true }) },
      resolve: (v, args) => isCreator(v, args.creatorKey),
    }),
    hidden: t.boolean({
      nullable: true,
      description: 'Admin only.',
      authScopes: { admin: true },
      unauthorizedResolver: () => null,
      resolve: (v) => v.hidden,
    }),
  }),
});

/** An edge outside any connection, so a client can `@prependEdge` a saved patch. */
export const Juno60VoiceEdgeRef = builder.objectRef<Juno60VoiceDoc>('DmbkSoundJuno60VoiceEdge').implement({
  description: 'A patch with its cursor in the `dmbkSoundJuno60Voices` ordering.',
  fields: (t) => ({
    cursor: t.string({ resolve: (v) => cursorFor(v) }),
    node: t.field({ type: Juno60VoiceRef, resolve: (v) => v }),
  }),
});
