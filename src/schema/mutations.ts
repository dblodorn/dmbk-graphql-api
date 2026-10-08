import { builder } from './builder.js';
import { issueNonce, verifySiwe } from '../auth/siwe.js';
import { issueToken, viewerFor, type Viewer } from '../auth/token.js';
import { setPhotoHidden, updatePhoto } from '../lib/photos/repository.js';
import { setImageHidden, setTrainingHidden } from '../lib/lora/repository.js';
import { PhotoRef } from './types/photo.js';
import { GeneratedImageRef, LoraTrainingRef } from './types/lora.js';
import { ViewerRef } from './types/viewer.js';

/*
 * Every mutation here is a Relay input-object mutation: one `input` argument,
 * a payload carrying the changed node, and an optional clientMutationId. Relay
 * merges the returned node into its store by global ID, so a client should
 * select the fields it displays in the payload.
 *
 * Mutations return the repository's result directly rather than reloading
 * through the per-request loader, which may hold a pre-mutation copy.
 */

builder.mutationType({});

// ---------------------------------------------------------------------------
// Auth

builder.mutationField('siweNonce', (t) =>
  t.string({
    description: 'A single-use nonce to embed in a SIWE message. Expires after 10 minutes.',
    resolve: () => issueNonce(),
  }),
);

builder.relayMutationField(
  'signInWithEthereum',
  {
    inputFields: (t) => ({
      message: t.string({ required: true, description: 'The EIP-4361 message the wallet signed.' }),
      signature: t.string({ required: true }),
    }),
  },
  {
    resolve: async (_root, { input }) => {
      const address = await verifySiwe(input.message, input.signature);
      return { token: issueToken(address), viewer: viewerFor(address) };
    },
  },
  {
    outputFields: (t) => ({
      token: t.string({
        description: 'Send as `Authorization: Bearer <token>`. Valid for 7 days.',
        resolve: (payload) => payload.token,
      }),
      viewer: t.field({ type: ViewerRef, resolve: (payload: { viewer: Viewer }) => payload.viewer }),
    }),
  },
);

// ---------------------------------------------------------------------------
// Photos (admin)

builder.relayMutationField(
  'updatePhoto',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: PhotoRef }),
      title: t.string({ description: 'Omit to leave unchanged; null clears it.' }),
      keywords: t.stringList({ description: "Omit to leave unchanged. Replaces the photo's full set." }),
    }),
  },
  {
    authScopes: { admin: true },
    resolve: async (_root, { input }) => {
      const photo = await updatePhoto({
        id: input.id.id,
        title: input.title,
        keywords: input.keywords,
      });
      return { photo };
    },
  },
  {
    outputFields: (t) => ({
      photo: t.field({ type: PhotoRef, resolve: (payload) => payload.photo }),
    }),
  },
);

builder.relayMutationField(
  'setPhotoHidden',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: PhotoRef }),
      hidden: t.boolean({ required: true }),
    }),
  },
  {
    authScopes: { admin: true },
    resolve: async (_root, { input }) => ({ photo: await setPhotoHidden(input.id.id, input.hidden) }),
  },
  {
    outputFields: (t) => ({
      photo: t.field({ type: PhotoRef, resolve: (payload) => payload.photo }),
    }),
  },
);

// ---------------------------------------------------------------------------
// LoRA (owner)

builder.relayMutationField(
  'setLoraTrainingHidden',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: LoraTrainingRef }),
      hidden: t.boolean({ required: true }),
    }),
  },
  {
    authScopes: { signedIn: true },
    resolve: async (_root, { input }, context) => ({
      loraTraining: await setTrainingHidden(context.viewer!, input.id.id, input.hidden),
    }),
  },
  {
    outputFields: (t) => ({
      loraTraining: t.field({ type: LoraTrainingRef, resolve: (payload) => payload.loraTraining }),
    }),
  },
);

builder.relayMutationField(
  'setGeneratedImageHidden',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: GeneratedImageRef }),
      hidden: t.boolean({ required: true }),
    }),
  },
  {
    authScopes: { signedIn: true },
    resolve: async (_root, { input }, context) => ({
      generatedImage: await setImageHidden(context.viewer!, input.id.id, input.hidden),
    }),
  },
  {
    outputFields: (t) => ({
      generatedImage: t.field({ type: GeneratedImageRef, resolve: (payload) => payload.generatedImage }),
    }),
  },
);
