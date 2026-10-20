import { builder } from '../builder.js';
import type { GeneratedImageDoc, LoraTrainingDoc } from '../../models/lora.js';
import { isOwner, listImagesForTraining } from '../../lib/lora/repository.js';
import { toConnection } from '../connection.js';

export const LoraStatusEnum = builder.enumType('LoraStatus', {
  values: {
    COMPLETED: { value: 'completed' },
    PENDING: { value: 'pending' },
    FAILED: { value: 'failed' },
  } as const,
});

export const LoraTrainingRef = builder.objectRef<LoraTrainingDoc>('LoraTraining');
export const GeneratedImageRef = builder.objectRef<GeneratedImageDoc>('GeneratedImage');

// Owner-only fields (wallet address, hidden flag, raw training data) resolve to
// null for anyone but the record's own wallet.
const ownerOnly = {
  authScopes: (doc: { walletAddress: string }, _args: object, context: { viewer: Parameters<typeof isOwner>[0] }) =>
    isOwner(context.viewer, doc),
  unauthorizedResolver: () => null,
  nullable: true,
} as const;

builder.node(LoraTrainingRef, {
  description: 'A trained LoRA. The public sees completed, visible trainings; owners also see their own others.',
  id: { resolve: (lora) => lora._id },
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'triggerWord' in value,
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.trainingLoader.load(id))),
  fields: (t) => ({
    triggerWord: t.exposeString('triggerWord'),
    steps: t.exposeInt('steps'),
    status: t.field({ type: LoraStatusEnum, resolve: (l) => l.status }),
    createdAt: t.exposeString('createdAt', { description: 'ISO-8601.' }),
    trainingImageUrls: t.stringList({
      description: 'Source images, preferring the DO Spaces mirrors when they exist.',
      resolve: (l) => (l.imageUrlsSpaces?.length ? l.imageUrlsSpaces : l.imageUrls),
    }),
    loraWeightsUrl: t.exposeString('loraWeightsUrl', { nullable: true }),
    arenaChannelUrl: t.exposeString('arenaChannelUrl', { nullable: true }),
    arenaChannelTitle: t.exposeString('arenaChannelTitle', { nullable: true }),

    walletAddress: t.string({ ...ownerOnly, description: 'Owner only.', resolve: (l) => l.walletAddress }),
    hidden: t.boolean({ ...ownerOnly, description: 'Owner only.', resolve: (l) => l.hidden === true }),
    trainingZipUrl: t.string({ ...ownerOnly, description: 'Owner only.', resolve: (l) => l.trainingZipUrl }),

    images: t.connection({
      type: GeneratedImageRef,
      description: 'Visible images generated with this LoRA, newest first.',
      resolve: async (l, args) => toConnection(await listImagesForTraining(l._id, args)),
    }),
  }),
});

builder.node(GeneratedImageRef, {
  description: 'An image generated with a LoRA.',
  id: { resolve: (img) => img._id },
  isTypeOf: (value) => typeof value === 'object' && value !== null && 'prompt' in value,
  loadMany: (ids, context) => Promise.all(ids.map((id) => context.imageLoader.load(id))),
  fields: (t) => ({
    prompt: t.exposeString('prompt'),
    url: t.string({
      description: 'The DO Spaces copy when mirrored, otherwise the original fal.ai URL.',
      resolve: (img) => img.cdnUrl ?? img.imageUrl,
    }),
    width: t.int({ nullable: true, resolve: (img) => img.imageWidth }),
    height: t.int({ nullable: true, resolve: (img) => img.imageHeight }),
    seed: t.exposeString('seed', { nullable: true }),
    loraScaleValue: t.exposeString('loraScaleValue', { nullable: true }),
    loraScaleName: t.exposeString('loraScaleName', { nullable: true }),
    createdAt: t.exposeString('createdAt', { description: 'ISO-8601.' }),
    training: t.field({
      type: LoraTrainingRef,
      nullable: true,
      description: 'Null when the LoRA is hidden from this viewer.',
      resolve: (img, _args, context) => context.trainingLoader.load(img.loraTrainingId),
    }),

    walletAddress: t.string({ ...ownerOnly, description: 'Owner only.', resolve: (img) => img.walletAddress }),
    hidden: t.boolean({ ...ownerOnly, description: 'Owner only.', resolve: (img) => img.hidden === true }),
  }),
});
