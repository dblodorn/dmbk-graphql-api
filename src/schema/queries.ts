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
import { listVisibleCompositions } from '../lib/chime/repository.js';
import { ChimeCompositionRef } from './types/chime.js';
import { listVisibleVoices } from '../lib/vz/repository.js';
import { VzVoiceRef } from './types/vz.js';
import { listVisibleVoices as listVisibleDx7Voices } from '../lib/dx7/repository.js';
import { Dx7BankRef, Dx7VoiceRef } from './types/dx7.js';
import { listVisibleBanks as listVisibleDx7Banks } from '../lib/dx7/banks.js';
import { listVisibleVoices as listVisibleJuno60Voices } from '../lib/juno60/repository.js';
import { Juno60VoiceRef } from './types/juno60.js';

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

builder.queryField('dmbkSoundChimeCompositions', (t) =>
  t.connection({
    type: ChimeCompositionRef,
    description: 'Saved windchime compositions that are not hidden, newest first.',
    resolve: async (_root, args) => toConnection(await listVisibleCompositions(args)),
  }),
);

builder.queryField('dmbkSoundVzVoices', (t) =>
  t.connection({
    type: VzVoiceRef,
    description: 'Saved VZ voices that are not hidden, newest first. `creatorKey` narrows them to that device key\'s voices; `search` to names containing the text.',
    args: {
      creatorKey: t.arg.string({ description: 'A device key: only the voices it saved.' }),
      search: t.arg.string({ description: 'Names containing this text, ignoring case; at most 12 characters.' }),
    },
    resolve: async (_root, args) => toConnection(await listVisibleVoices(args, { creatorKey: args.creatorKey, search: args.search })),
  }),
);

builder.queryField('dmbkSoundDx7Voices', (t) =>
  t.connection({
    type: Dx7VoiceRef,
    description: 'Saved DX7 voices that are not hidden, newest first. `creatorKey` narrows them to that device key\'s voices; `search` to names containing the text.',
    args: {
      creatorKey: t.arg.string({ description: 'A device key: only the voices it saved.' }),
      search: t.arg.string({ description: 'Names containing this text, ignoring case; at most 10 characters.' }),
    },
    resolve: async (_root, args) => toConnection(await listVisibleDx7Voices(args, { creatorKey: args.creatorKey, search: args.search })),
  }),
);

builder.queryField('dmbkSoundJuno60Voices', (t) =>
  t.connection({
    type: Juno60VoiceRef,
    description: 'Saved Juno-60 patches that are not hidden, newest first (Roland\'s factory patches among them). `creatorKey` narrows them to that device key\'s patches; `search` to names containing the text.',
    args: {
      creatorKey: t.arg.string({ description: 'A device key: only the patches it saved.' }),
      search: t.arg.string({ description: 'Names containing this text, ignoring case; at most 16 characters.' }),
    },
    resolve: async (_root, args) => toConnection(await listVisibleJuno60Voices(args, { creatorKey: args.creatorKey, search: args.search })),
  }),
);

builder.queryField('dmbkSoundDx7Banks', (t) =>
  t.connection({
    type: Dx7BankRef,
    description: 'Saved DX7 banks that are not hidden, newest first (the factory ROM cards among them). `creatorKey` narrows them to that device key\'s banks; `search` to names containing the text.',
    args: {
      creatorKey: t.arg.string({ description: 'A device key: only the banks it saved.' }),
      search: t.arg.string({ description: 'Names containing this text, ignoring case; at most 20 characters.' }),
    },
    resolve: async (_root, args) => toConnection(await listVisibleDx7Banks(args, { creatorKey: args.creatorKey, search: args.search })),
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
