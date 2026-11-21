import { builder } from '../builder.js';
import type { VzVoiceDoc } from '../../models/vz.js';
import { DATA_LENGTH, VOICE_BYTES } from '../../lib/vz/shape.js';
import { isCreator } from '../../lib/vz/repository.js';
import { cursorFor } from '../../lib/cursor.js';

/*
 * Saved VZ-1 / VZ-10M voices (openspec/specs/vz-voices), saved anonymously by
 * vz10m (vz10m.dmbk.io). A voice is its 336 decoded SysEx data bytes, base64;
 * the editor decodes everything else from them.
 */

/**
 * A patch in an external synth's library, whatever the synth: windchime fetches
 * one with `node(id) { ... on SynthPatch { name data } }` without knowing the
 * synth's own type (openspec/specs/vz-voices, "Synth patch interface"). Every
 * later synth's patch type implements it too.
 */
export const SynthPatchRef = builder.interfaceRef<{ name: string; data: string }>('SynthPatch').implement({
  description: "A patch in an external synth's library: its display name and its bytes. VzVoice and Dx7Voice are ones.",
  interfaces: [builder.nodeInterfaceRef()],
  fields: (t) => ({
    name: t.exposeString('name', { description: "The patch's display name; may be empty." }),
    data: t.exposeString('data', { description: "The patch's bytes as base64, in the synth's own format." }),
  }),
});

export const VzVoiceRef = builder.objectRef<VzVoiceDoc>('VzVoice');

builder.node(VzVoiceRef, {
  description: 'A VZ-1 / VZ-10M voice saved anonymously. Hidden ones are visible to admins only.',
  interfaces: [SynthPatchRef],
  id: { resolve: (v) => v._id },
  // every synth's voice documents have the same fields, so the data's length tells a VZ voice from another synth's
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'creatorHash' in value && (value as VzVoiceDoc).data.length === DATA_LENGTH,
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.vzVoiceLoader.load(id))),
  fields: (t) => ({
    name: t.exposeString('name', { description: "The voice's name as the VZ shows it, read from the bytes; may be empty." }),
    data: t.exposeString('data', { description: `The ${VOICE_BYTES} decoded voice bytes as base64 (${DATA_LENGTH} characters).` }),
    createdAt: t.exposeString('createdAt', { description: 'ISO-8601. The listing is ordered by this.' }),
    updatedAt: t.exposeString('updatedAt', { description: 'ISO-8601. Equals createdAt until the voice is updated.' }),
    yours: t.boolean({
      description: 'Whether this device key saved the voice. The key is never stored, only compared by hash.',
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

/** An edge outside any connection, so a client can `@prependEdge` a saved voice. */
export const VzVoiceEdgeRef = builder.objectRef<VzVoiceDoc>('DmbkSoundVzVoiceEdge').implement({
  description: 'A voice with its cursor in the `dmbkSoundVzVoices` ordering.',
  fields: (t) => ({
    cursor: t.string({ resolve: (v) => cursorFor(v) }),
    node: t.field({ type: VzVoiceRef, resolve: (v) => v }),
  }),
});
