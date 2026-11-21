import { builder } from '../builder.js';
import type { Dx7VoiceDoc } from '../../models/dx7.js';
import { DATA_LENGTH, VOICE_BYTES } from '../../lib/dx7/shape.js';
import { isCreator } from '../../lib/dx7/repository.js';
import { cursorFor } from '../../lib/cursor.js';
import { SynthPatchRef } from './vz.js';

/*
 * Saved Yamaha DX7 voices (openspec/specs/dx7-voices), saved anonymously by the dx7 editor (dx7.dmbk.io). A voice
 * is its 155 unpacked VCED bytes, base64; the editor decodes everything else from them. Implements SynthPatch, so
 * windchime fetches one the way it fetches a VZ voice.
 */

export const Dx7VoiceRef = builder.objectRef<Dx7VoiceDoc>('Dx7Voice');

builder.node(Dx7VoiceRef, {
  description: 'A Yamaha DX7 voice saved anonymously. Hidden ones are visible to admins only.',
  interfaces: [SynthPatchRef],
  id: { resolve: (v) => v._id },
  // every synth's voice documents have the same fields, so the data's length tells a DX7 voice from another synth's
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'creatorHash' in value && (value as Dx7VoiceDoc).data.length === DATA_LENGTH,
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.dx7VoiceLoader.load(id))),
  fields: (t) => ({
    name: t.exposeString('name', { description: "The voice's name as the DX7 shows it, read from the bytes; may be empty." }),
    data: t.exposeString('data', { description: `The ${VOICE_BYTES} unpacked voice bytes (VCED, OP6 first) as base64 (${DATA_LENGTH} characters).` }),
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
export const Dx7VoiceEdgeRef = builder.objectRef<Dx7VoiceDoc>('DmbkSoundDx7VoiceEdge').implement({
  description: 'A voice with its cursor in the `dmbkSoundDx7Voices` ordering.',
  fields: (t) => ({
    cursor: t.string({ resolve: (v) => cursorFor(v) }),
    node: t.field({ type: Dx7VoiceRef, resolve: (v) => v }),
  }),
});
