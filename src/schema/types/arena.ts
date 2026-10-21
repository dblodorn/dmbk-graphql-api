import { builder } from '../builder.js';
import type { ArenaChannel, ArenaImage } from '../../lib/arena/client.js';
import type { ArenaProfile } from '../../lib/arena/profile.js';
import { channelConnection, imageConnection, listChannelsFor } from '../../lib/arena/channels.js';

/*
 * Are.na, read anonymously through its v3 API. Only public and closed
 * channels ever appear here (see `lib/arena/client.ts`). Are.na isn't one of
 * this API's databases, so these fields take an `arena` prefix in the spirit of
 * `graphql-schema-naming`.
 */

export const ArenaVisibilityEnum = builder.enumType('ArenaVisibility', {
  description: 'Private channels are never returned, so only these two appear.',
  values: {
    PUBLIC: { value: 'public', description: 'Anyone can view and add to it.' },
    CLOSED: { value: 'closed', description: 'Anyone can view it; only collaborators can add to it.' },
  } as const,
});

export const ArenaChannelSourceEnum = builder.enumType('ArenaChannelSource', {
  values: {
    ALL: { value: 'all', description: "The user's own channels and their groups' channels." },
    OWN: { value: 'own', description: 'Channels the user created, including ones owned by a group.' },
    GROUPS: { value: 'groups', description: "Channels of the groups the user belongs to." },
  } as const,
});

interface ArenaUserShape {
  id: number;
  slug: string;
  name: string;
  avatarUrl: string | null;
}

const ArenaUserRef = builder.objectRef<ArenaUserShape>('ArenaUser').implement({
  description: 'An Are.na user.',
  fields: (t) => ({
    id: t.int({ resolve: (u) => u.id }),
    slug: t.exposeString('slug', { description: 'The username in are.na/<slug>.' }),
    name: t.exposeString('name'),
    avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
  }),
});

const ArenaChannelOwnerRef = builder.objectRef<ArenaChannel['owner']>('ArenaChannelOwner').implement({
  description: 'The user or group that owns a channel.',
  fields: (t) => ({
    slug: t.exposeString('slug'),
    name: t.exposeString('name'),
    isGroup: t.boolean({ resolve: (o) => o.type === 'Group' }),
  }),
});

export const ArenaImageRef = builder.objectRef<ArenaImage>('ArenaImage').implement({
  description: 'An image block in an Are.na channel.',
  fields: (t) => ({
    id: t.int({ resolve: (b) => b.id }),
    title: t.string({ nullable: true, resolve: (b) => b.title ?? null }),
    src: t.string({ description: 'The original image.', resolve: (b) => b.image.src }),
    thumbnailSrc: t.string({
      description: 'A version about 400px on its longest side (served from images.are.na), or the original when there is none.',
      resolve: (b) => b.image.small?.src ?? b.image.medium?.src ?? b.image.src,
    }),
    width: t.int({ nullable: true, resolve: (b) => b.image.width ?? null }),
    height: t.int({ nullable: true, resolve: (b) => b.image.height ?? null }),
  }),
});

export const ArenaChannelRef = builder.objectRef<ArenaChannel>('ArenaChannel').implement({
  description: 'A public or closed Are.na channel.',
  fields: (t) => ({
    id: t.int({ resolve: (c) => c.id }),
    slug: t.exposeString('slug'),
    title: t.exposeString('title'),
    url: t.string({
      description: 'The channel on are.na.',
      resolve: (c) => `https://www.are.na/${c.owner.slug}/${c.slug}`,
    }),
    visibility: t.field({
      type: ArenaVisibilityEnum,
      resolve: (c) => (c.visibility === 'closed' ? 'closed' : 'public'),
    }),
    blockCount: t.int({ nullable: true, resolve: (c) => c.counts?.blocks ?? null }),
    updatedAt: t.exposeString('updated_at', { description: 'ISO-8601.' }),
    owner: t.field({ type: ArenaChannelOwnerRef, resolve: (c) => c.owner }),
    images: t.connection({
      type: ArenaImageRef,
      description:
        "The channel's image blocks, in the owner's order. One Are.na page per request, so a page can hold fewer than `first`; follow `hasNextPage`.",
      resolve: (c, args) => imageConnection(c.id, args),
    }),
  }),
});

export const ArenaProfileRef = builder.objectRef<ArenaProfile>('ArenaProfile').implement({
  description: "The Are.na user this account saved with `arenaSetUser`. Not verified: it only selects public data.",
  fields: (t) => ({
    user: t.field({
      type: ArenaUserRef,
      resolve: (p) => ({ id: p.arenaUserId, slug: p.arenaSlug, name: p.arenaName, avatarUrl: p.arenaAvatarUrl }),
    }),
    channels: t.connection(
      {
        type: ArenaChannelRef,
        description:
          "The user's public and closed channels plus their groups' channels, most recently updated first. Capped at 1,000.",
        args: { source: t.arg({ type: ArenaChannelSourceEnum, defaultValue: 'all' }) },
        resolve: async (p, args) => {
          const list = await listChannelsFor(p.arenaUserId, args.source ?? 'all');
          return { ...channelConnection(list, args), truncated: list.truncated };
        },
      },
      {
        fields: (c) => ({
          totalCount: c.int({ resolve: (conn) => (conn as unknown as { totalCount: number }).totalCount }),
          truncated: c.boolean({
            description: 'More channels exist than the 1,000 returned.',
            resolve: (conn) => (conn as unknown as { truncated: boolean }).truncated,
          }),
        }),
      },
    ),
  }),
});
