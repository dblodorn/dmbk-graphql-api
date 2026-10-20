import { builder } from '../builder.js';
import type { Viewer } from '../../auth/viewer.js';
import { listOwnImages, listOwnTrainings } from '../../lib/lora/repository.js';
import { toConnection } from '../connection.js';
import { VisibilityEnum } from './photo.js';
import { GeneratedImageRef, LoraTrainingRef } from './lora.js';

export const ViewerRef = builder.objectRef<Viewer>('Viewer').implement({
  description: 'The signed-in account.',
  fields: (t) => ({
    id: t.exposeString('id', { description: "The account's user id; LoRA records name it as their owner." }),
    email: t.exposeString('email'),
    name: t.exposeString('name', { nullable: true }),
    isAdmin: t.exposeBoolean('isAdmin', { description: 'May curate the photo library.' }),
    loraTrainerTrainings: t.connection({
      type: LoraTrainingRef,
      description: "This account's own trainings, at any status.",
      args: { visibility: t.arg({ type: VisibilityEnum, defaultValue: 'any' }) },
      resolve: async (viewer, args) =>
        toConnection(await listOwnTrainings(viewer, args.visibility ?? 'any', args)),
    }),
    loraTrainerImages: t.connection({
      type: GeneratedImageRef,
      description: 'Images this account generated.',
      args: { visibility: t.arg({ type: VisibilityEnum, defaultValue: 'any' }) },
      resolve: async (viewer, args) => toConnection(await listOwnImages(viewer, args.visibility ?? 'any', args)),
    }),
  }),
});
