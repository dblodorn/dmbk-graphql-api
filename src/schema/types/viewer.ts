import { builder } from '../builder.js';
import type { Viewer } from '../../auth/token.js';
import { listOwnImages, listOwnTrainings } from '../../lib/lora/repository.js';
import { toConnection } from '../connection.js';
import { VisibilityEnum } from './photo.js';
import { GeneratedImageRef, LoraTrainingRef } from './lora.js';

export const ViewerRef = builder.objectRef<Viewer>('Viewer').implement({
  description: 'The signed-in wallet.',
  fields: (t) => ({
    address: t.exposeString('address', { description: 'Lowercased.' }),
    isAdmin: t.exposeBoolean('isAdmin', { description: 'May curate the photo library.' }),
    loraTrainings: t.connection({
      type: LoraTrainingRef,
      description: "This wallet's own trainings, at any status.",
      args: { visibility: t.arg({ type: VisibilityEnum, defaultValue: 'any' }) },
      resolve: async (viewer, args) =>
        toConnection(await listOwnTrainings(viewer, args.visibility ?? 'any', args)),
    }),
    generatedImages: t.connection({
      type: GeneratedImageRef,
      description: 'Images this wallet generated.',
      args: { visibility: t.arg({ type: VisibilityEnum, defaultValue: 'any' }) },
      resolve: async (viewer, args) => toConnection(await listOwnImages(viewer, args.visibility ?? 'any', args)),
    }),
  }),
});
