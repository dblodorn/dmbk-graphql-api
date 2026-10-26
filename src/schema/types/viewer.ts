import { builder } from '../builder.js';
import type { Viewer } from '../../auth/viewer.js';
import { findOwnTrainingByRequestId, listOwnImages, listOwnTrainings } from '../../lib/lora/repository.js';
import { toConnection } from '../connection.js';
import { VisibilityEnum } from './photo.js';
import { GeneratedImageRef, LoraTrainingRef } from './lora.js';
import { ArenaProfileRef } from './arena.js';
import { getArenaProfile } from '../../lib/arena/profile.js';

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
    loraTrainerTrainingByRequestId: t.field({
      type: LoraTrainingRef,
      nullable: true,
      description: "This account's own training for a fal.ai request id, at any status, or null.",
      args: { requestId: t.arg.string({ required: true }) },
      resolve: (viewer, args) => findOwnTrainingByRequestId(viewer, args.requestId),
    }),
    arena: t.field({
      type: ArenaProfileRef,
      nullable: true,
      description: 'The Are.na user saved with `arenaSetUser`, or null.',
      resolve: (viewer) => getArenaProfile(viewer.id),
    }),
  }),
});
