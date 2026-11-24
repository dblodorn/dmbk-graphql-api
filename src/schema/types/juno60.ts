import { builder } from '../builder.js';
import type { Juno60VoiceDoc } from '../../models/juno60.js';
import { DATA_LENGTH, VOICE_BYTES } from '../../lib/juno60/shape.js';
import { isCreator } from '../../lib/juno60/repository.js';
import { cursorFor } from '../../lib/cursor.js';
import { SynthPatchRef } from './vz.js';

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
