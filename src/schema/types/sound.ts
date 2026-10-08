import { builder } from '../builder.js';
import type { SoundPlaylist, SoundSnapshotDoc, SoundTrack, SoundUser } from '../../models/photos.js';

/*
 * A cached SoundCloud snapshot, stored verbatim in snake_case. Exposed here in
 * camelCase; field meanings follow the SoundCloud API.
 */

export const SoundUserRef = builder.objectRef<SoundUser>('SoundUser').implement({
  fields: (t) => ({
    urn: t.exposeString('urn'),
    username: t.exposeString('username'),
    avatarUrl: t.string({ resolve: (u) => u.avatar_url }),
    permalinkUrl: t.string({ resolve: (u) => u.permalink_url }),
    trackCount: t.int({ resolve: (u) => u.track_count }),
    followersCount: t.int({ resolve: (u) => u.followers_count }),
  }),
});

export const SoundTrackRef = builder.objectRef<SoundTrack>('SoundTrack').implement({
  fields: (t) => ({
    urn: t.exposeString('urn'),
    title: t.exposeString('title'),
    artworkUrl: t.string({ nullable: true, resolve: (tr) => tr.artwork_url }),
    durationMs: t.int({ resolve: (tr) => tr.duration }),
    description: t.exposeString('description', { nullable: true }),
    genre: t.exposeString('genre', { nullable: true }),
    permalinkUrl: t.string({ resolve: (tr) => tr.permalink_url }),
    playbackCount: t.int({ resolve: (tr) => tr.playback_count }),
    downloadable: t.exposeBoolean('downloadable'),
    createdAt: t.string({ resolve: (tr) => tr.created_at }),
    user: t.field({ type: SoundUserRef, resolve: (tr) => tr.user }),
  }),
});

export const SoundPlaylistRef = builder.objectRef<SoundPlaylist>('SoundPlaylist').implement({
  fields: (t) => ({
    urn: t.exposeString('urn'),
    title: t.exposeString('title'),
    artworkUrl: t.string({ nullable: true, resolve: (p) => p.artwork_url }),
    description: t.exposeString('description', { nullable: true }),
    createdAt: t.string({ resolve: (p) => p.created_at }),
    trackCount: t.int({ resolve: (p) => p.track_count }),
    tracks: t.field({ type: [SoundTrackRef], resolve: (p) => p.tracks }),
    user: t.field({ type: SoundUserRef, resolve: (p) => p.user }),
  }),
});

export const SoundSnapshotRef = builder.objectRef<SoundSnapshotDoc>('SoundSnapshot').implement({
  fields: (t) => ({
    fetchedAt: t.exposeString('fetchedAt', { description: 'When this snapshot was taken from SoundCloud. ISO-8601.' }),
    playlists: t.field({ type: [SoundPlaylistRef], resolve: (s) => s.playlists }),
  }),
});
