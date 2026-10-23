import { builder } from './builder.js';
import { forbidden } from '../errors.js';
import { listKeywords, listPhotos, PUBLIC_SCOPE } from '../lib/photos/repository.js';
import { listPublicTrainings, slideshowImages } from '../lib/lora/repository.js';
import { SoundSnapshotModel, type SoundSnapshotDoc } from '../models/sound.js';
import { toConnection } from './connection.js';
import { KeywordRef, PhotoRef, PhotoStatusEnum, VisibilityEnum } from './types/photo.js';
import { LoraTrainerSlideshowImageRef, LoraTrainingRef } from './types/lora.js';
import { SoundSnapshotRef } from './types/sound.js';
import { ViewerRef } from './types/viewer.js';
import { ArenaChannelRef } from './types/arena.js';
import { getChannel } from '../lib/arena/client.js';

builder.queryType({});

builder.queryField('_health', (t) => t.string({ resolve: () => 'ok' }));

builder.queryField('viewer', (t) =>
  t.field({
    type: ViewerRef,
    nullable: true,
    description: 'The signed-in wallet, or null when anonymous.',
    resolve: (_root, _args, context) => context.viewer,
  }),
);

builder.queryField('dmbkPhotos', (t) =>
  t.connection({
    type: PhotoRef,
    description: 'Photos, newest first.',
    args: {
      keywords: t.arg.stringList({ description: 'Every keyword must be present. Normalized like stored keywords.' }),
      visibility: t.arg({ type: VisibilityEnum, description: 'Admin only unless VISIBLE (the default).' }),
      states: t.arg({ type: [PhotoStatusEnum], description: 'Admin only unless [READY] (the default).' }),
    },
    resolve: async (_root, args, context) => {
      const visibility = args.visibility ?? 'visible';
      const states = args.states?.length ? args.states : ['ready' as const];
      const widened = visibility !== 'visible' || states.length !== 1 || states[0] !== 'ready';

      // Refused rather than silently narrowed: narrowing would let a caller
      // believe its filter worked when it did not.
      if (widened && !context.viewer?.isAdmin) {
        throw forbidden('Filtering by visibility or state requires an admin session.');
      }

      const scope = widened ? { visibility, states } : PUBLIC_SCOPE;
      return toConnection(await listPhotos({ ...args, keywords: args.keywords, scope }));
    },
  }),
);

builder.queryField('dmbkPhotosKeywords', (t) =>
  t.field({
    type: [KeywordRef],
    description: 'The photo keyword vocabulary, most used first.',
    resolve: () => listKeywords(),
  }),
);

builder.queryField('loraTrainerTrainings', (t) =>
  t.connection({
    type: LoraTrainingRef,
    description: 'Completed, visible LoRA trainings, newest first.',
    resolve: async (_root, args) => toConnection(await listPublicTrainings(args)),
  }),
);

builder.queryField('loraTrainerSlideshowImages', (t) =>
  t.field({
    type: [LoraTrainerSlideshowImageRef],
    description:
      'Up to `count` (1–20) distinct images in random order, from visible generated images and visible, completed trainings.',
    args: { count: t.arg.int({ required: true, defaultValue: 10 }) },
    resolve: (_root, args) => slideshowImages(args.count),
  }),
);

builder.queryField('dmbkSoundPlaylists', (t) =>
  t.field({
    type: SoundSnapshotRef,
    nullable: true,
    description: 'The latest cached SoundCloud playlists snapshot.',
    resolve: () => SoundSnapshotModel.findById('playlists').lean<SoundSnapshotDoc>().exec(),
  }),
);

builder.queryField('arenaChannel', (t) =>
  t.field({
    type: ArenaChannelRef,
    nullable: true,
    description: 'A public or closed Are.na channel by slug, or null when it is private or does not exist.',
    args: { slug: t.arg.string({ required: true }) },
    resolve: (_root, args) => getChannel(args.slug.trim()),
  }),
);
