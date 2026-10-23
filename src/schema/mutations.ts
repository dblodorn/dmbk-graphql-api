import { builder } from './builder.js';
import { signInWithGoogle, signOut, type Viewer } from '../auth/viewer.js';
import { setPhotoHidden, updatePhoto } from '../lib/photos/repository.js';
import { deletePhotoWithFiles, finalizePhoto, reservePhotoUpload } from '../lib/photos/upload.js';
import { cursorFor } from '../lib/cursor.js';
import type { PhotoDoc } from '../models/photos.js';
import {
  completeTraining,
  createTraining,
  recordImages,
  setImageHidden,
  setTrainingAssets,
  setTrainingHidden,
} from '../lib/lora/repository.js';
import { PhotoRef } from './types/photo.js';
import { GeneratedImageRef, LoraTrainingRef } from './types/lora.js';
import { ViewerRef } from './types/viewer.js';
import { clearArenaProfile, setArenaProfile } from '../lib/arena/profile.js';

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

builder.relayMutationField(
  'signInWithGoogle',
  {
    inputFields: (t) => ({
      idToken: t.string({
        required: true,
        description: 'A Google ID token (Google Identity Services `credential`) issued to this API\'s OAuth client.',
      }),
    }),
  },
  {
    resolve: async (_root, { input }) => signInWithGoogle(input.idToken),
  },
  {
    outputFields: (t) => ({
      token: t.string({
        description: 'Send as `Authorization: Bearer <token>`. Revoked by `signOut`.',
        resolve: (payload) => payload.token,
      }),
      viewer: t.field({ type: ViewerRef, resolve: (payload: { viewer: Viewer }) => payload.viewer }),
    }),
  },
);

builder.mutationField('signOut', (t) =>
  t.boolean({
    description: "Revoke this request's session. False when there was no valid session to revoke.",
    resolve: (_root, _args, context) => signOut(context.request),
  }),
);

// ---------------------------------------------------------------------------
// Photos (admin)

builder.relayMutationField(
  'dmbkPhotosUpdatePhoto',
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
  'dmbkPhotosSetPhotoHidden',
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

/** An edge outside any connection, so the admin list can `@prependEdge` a finalized photo. */
const PhotoEdgeRef = builder.objectRef<PhotoDoc>('DmbkPhotosPhotoEdge').implement({
  description: "A photo with its cursor in the `dmbkPhotos` ordering.",
  fields: (t) => ({
    cursor: t.string({ resolve: (photo) => cursorFor(photo) }),
    node: t.field({ type: PhotoRef, resolve: (photo) => photo }),
  }),
});

builder.relayMutationField(
  'dmbkPhotosReservePhotoUpload',
  {
    inputFields: (t) => ({
      contentType: t.string({ required: true, description: 'image/jpeg, image/png, image/webp or image/avif.' }),
      byteSize: t.int({ required: true, description: 'Size of the original in bytes; at most 50 MB.' }),
      title: t.string(),
      keywords: t.stringList(),
    }),
  },
  {
    authScopes: { admin: true },
    resolve: (_root, { input }) =>
      reservePhotoUpload({
        contentType: input.contentType,
        byteSize: input.byteSize,
        title: input.title,
        keywords: input.keywords,
      }),
  },
  {
    outputFields: (t) => ({
      photo: t.field({ type: PhotoRef, description: 'The new photo, `PENDING`.', resolve: (payload) => payload.photo }),
      uploadUrl: t.string({
        description:
          'PUT the original here, with the same Content-Type, then call `dmbkPhotosFinalizePhoto`. Expires after 15 minutes.',
        resolve: (payload) => payload.uploadUrl,
      }),
    }),
  },
);

builder.relayMutationField(
  'dmbkPhotosFinalizePhoto',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: PhotoRef }),
      title: t.string({ description: "Omit to keep the reservation's; null clears it." }),
      keywords: t.stringList({ description: "Omit to keep the reservation's. Replaces the full set." }),
    }),
  },
  {
    authScopes: { admin: true },
    resolve: async (_root, { input }) => {
      const photo = await finalizePhoto({ id: input.id.id, title: input.title, keywords: input.keywords });
      return { photo };
    },
  },
  {
    outputFields: (t) => ({
      photo: t.field({ type: PhotoRef, resolve: (payload) => payload.photo }),
      photoEdge: t.field({ type: PhotoEdgeRef, resolve: (payload) => payload.photo }),
    }),
  },
);

builder.relayMutationField(
  'dmbkPhotosDeletePhoto',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: PhotoRef }),
    }),
  },
  {
    authScopes: { admin: true },
    resolve: async (_root, { input }) => {
      await deletePhotoWithFiles(input.id.id);
      return { id: input.id.id };
    },
  },
  {
    outputFields: (t) => ({
      deletedPhotoId: t.globalID({
        description: 'For Relay `@deleteRecord`.',
        resolve: (payload) => ({ type: 'Photo', id: payload.id }),
      }),
    }),
  },
);

// ---------------------------------------------------------------------------
// LoRA (owner)

builder.relayMutationField(
  'loraTrainerSetTrainingHidden',
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
  'loraTrainerSetImageHidden',
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

// ---------------------------------------------------------------------------
// LoRA records (signed in). lora-trainer runs the fal.ai work and the Spaces
// mirroring; these record what it produced. URL rules: lib/lora/urls.ts.

builder.relayMutationField(
  'loraTrainerCreateTraining',
  {
    inputFields: (t) => ({
      requestId: t.string({ required: true, description: 'The fal.ai queue request id. One training per request.' }),
      triggerWord: t.string({ required: true, description: '1–50 characters.' }),
      steps: t.int({ required: true, description: '100–2000.' }),
      imageUrls: t.stringList({ required: true, description: '1–20 https source image URLs.' }),
      arenaChannelUrl: t.string(),
      arenaChannelTitle: t.string({ description: 'Up to 200 characters.' }),
    }),
  },
  {
    authScopes: { signedIn: true },
    resolve: async (_root, { input }, context) => ({
      loraTraining: await createTraining(context.viewer!, input),
    }),
  },
  {
    outputFields: (t) => ({
      loraTraining: t.field({ type: LoraTrainingRef, resolve: (payload) => payload.loraTraining }),
    }),
  },
);

builder.relayMutationField(
  'loraTrainerSetTrainingAssets',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: LoraTrainingRef }),
      trainingZipUrl: t.string({ description: 'Spaces CDN, under lora-trainer/. Omit to leave unchanged.' }),
      imageUrlsSpaces: t.stringList({
        description: 'Spaces mirrors of the source images, under lora-trainer/. Omit to leave unchanged.',
      }),
    }),
  },
  {
    authScopes: { signedIn: true },
    resolve: async (_root, { input }, context) => ({
      loraTraining: await setTrainingAssets(context.viewer!, input.id.id, input),
    }),
  },
  {
    outputFields: (t) => ({
      loraTraining: t.field({ type: LoraTrainingRef, resolve: (payload) => payload.loraTraining }),
    }),
  },
);

builder.relayMutationField(
  'loraTrainerCompleteTraining',
  {
    inputFields: (t) => ({
      id: t.globalID({ required: true, for: LoraTrainingRef }),
      loraWeightsUrl: t.string({ required: true }),
      imageUrlsSpaces: t.stringList({ description: 'Backfilled source mirrors, under lora-trainer/. Replaces the stored ones.' }),
    }),
  },
  {
    authScopes: { signedIn: true },
    description: 'Mark a training completed. Already completed: changes nothing.',
    resolve: async (_root, { input }, context) => ({
      loraTraining: await completeTraining(context.viewer!, input.id.id, input),
    }),
  },
  {
    outputFields: (t) => ({
      loraTraining: t.field({ type: LoraTrainingRef, resolve: (payload) => payload.loraTraining }),
    }),
  },
);

const RecordImageInput = builder.inputType('LoraTrainerRecordImagesImageInput', {
  fields: (t) => ({
    id: t.string({
      required: true,
      description: "32 lowercase hex characters, chosen by the client (it keys the image's Spaces copy).",
    }),
    prompt: t.string({ required: true, description: '1–1000 characters.' }),
    imageUrl: t.string({ required: true, description: 'The fal.ai URL.' }),
    cdnUrl: t.string({ description: 'The Spaces copy, under lora-trainer/.' }),
    imageWidth: t.int(),
    imageHeight: t.int(),
    seed: t.string(),
    loraScaleValue: t.string(),
    loraScaleName: t.string(),
    genWidth: t.int({ description: 'The size requested from fal.ai.' }),
    genHeight: t.int(),
  }),
});

builder.relayMutationField(
  'loraTrainerRecordImages',
  {
    inputFields: (t) => ({
      loraTrainingId: t.globalID({ required: true, for: LoraTrainingRef }),
      images: t.field({ type: [RecordImageInput], required: true, description: '1–8 images.' }),
    }),
  },
  {
    authScopes: { signedIn: true },
    description: 'Record images generated with one completed LoRA, all or nothing.',
    resolve: async (_root, { input }, context) => {
      const { training, images } = await recordImages(context.viewer!, input.loraTrainingId.id, input.images);
      return { loraTraining: training, generatedImages: images };
    },
  },
  {
    outputFields: (t) => ({
      loraTraining: t.field({ type: LoraTrainingRef, resolve: (payload) => payload.loraTraining }),
      generatedImages: t.field({
        type: [GeneratedImageRef],
        description: 'In input order.',
        resolve: (payload) => payload.generatedImages,
      }),
    }),
  },
);

// ---------------------------------------------------------------------------
// Are.na (signed in)

builder.relayMutationField(
  'arenaSetUser',
  {
    inputFields: (t) => ({
      slug: t.string({ required: true, description: 'The Are.na username, as in are.na/<slug>.' }),
    }),
  },
  {
    authScopes: { signedIn: true },
    description: "Save this account's Are.na user. Fails with NOT_FOUND when Are.na doesn't know the slug.",
    resolve: async (_root, { input }, context) => {
      await setArenaProfile(context.viewer!.id, input.slug);
      return { viewer: context.viewer! };
    },
  },
  {
    outputFields: (t) => ({
      viewer: t.field({ type: ViewerRef, resolve: (payload: { viewer: Viewer }) => payload.viewer }),
    }),
  },
);

builder.mutationField('arenaClearUser', (t) =>
  t.boolean({
    authScopes: { signedIn: true },
    description: "Forget this account's Are.na user. True even when none was saved.",
    resolve: async (_root, _args, context) => {
      await clearArenaProfile(context.viewer!.id);
      return true;
    },
  }),
);
