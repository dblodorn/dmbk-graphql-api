import { Schema } from 'mongoose';
import { soundDb } from '../db/mongoose.js';

/*
 * Documents in `dmbk-sound`, written by the dmbk app
 * (src/lib/soundcloud/build-playlists.ts there is the only writer). This API
 * only reads them. Same conventions as `dmbk-photos`: string `_id`s, ISO-8601
 * strings, no `__v`, explicit collection names.
 */

const docOptions = { versionKey: false, timestamps: false, strict: true } as const;

/** A cached SoundCloud fetch. Currently a single document, `_id: "playlists"`. */
export interface SoundSnapshotDoc {
  _id: string;
  playlists: SoundPlaylist[];
  fetchedAt: string;
  schemaVersion: number;
}

export interface SoundUser {
  urn: string;
  username: string;
  avatar_url: string;
  permalink_url: string;
  kind: string;
  track_count: number;
  followers_count: number;
}

export interface SoundTrack {
  kind: string;
  title: string;
  urn: string;
  artwork_url: string | null;
  duration: number;
  description: string | null;
  genre: string | null;
  permalink_url: string;
  playback_count: number;
  downloadable: boolean;
  created_at: string;
  user: SoundUser;
}

export interface SoundPlaylist {
  kind: string;
  title: string;
  urn: string;
  artwork_url: string | null;
  description: string | null;
  created_at: string;
  track_count: number;
  tracks: SoundTrack[];
  user: SoundUser;
}

// Read-only from this API, and nested SoundCloud payloads are stored verbatim,
// so the subtree is left untyped at the schema level.
const soundSnapshotSchema = new Schema<SoundSnapshotDoc>(
  {
    _id: { type: String, required: true },
    playlists: { type: Schema.Types.Mixed },
    fetchedAt: { type: String },
    schemaVersion: { type: Number },
  },
  { ...docOptions, collection: 'sound_snapshots' },
);

export const SoundSnapshotModel = soundDb().model<SoundSnapshotDoc>('SoundSnapshot', soundSnapshotSchema);
