# Proposal

## Why

`dmbk-photos` holds one thing that isn't about photos: `sound_snapshots`, the cached SoundCloud playlists dmbk's `/sound` page builds from. Sound data should live in its own database so `dmbk-photos` stays photos-only (`photos`, `keywords`). That also gives later sound features a place to go. The collection holds a single document and has only one writer, so moving it now is cheap.

## What Changes

- New database **`dmbk-sound`** on the `dmbk-world` cluster, still owned by the dmbk app. `sound_snapshots` moves into it with the same collection name, `_id: "playlists"` document and shape.
- A one-off, re-runnable script in this repo (`scripts/move-sound-snapshots.ts`) copies the snapshot from `dmbk-photos` to `dmbk-sound`. It only reports by default. `--apply` copies, keeping whichever copy has the newer `fetchedAt`. `--drop-source` drops the old collection once the two copies match.
- **dmbk** (separate repo, its own PR) writes and reads the snapshot in `dmbk-sound` instead of the database named in its `MONGODB_URI`.
- This API reads the snapshot from `dmbk-sound`. A new env var `SOUND_DB_NAME` (default `dmbk-sound`) works like `PHOTOS_DB_NAME` / `LORA_DB_NAME`. The model moves out of `models/photos.ts` into its own `models/sound.ts`.
- **BREAKING (schema):** `dmbkPhotosSoundPlaylists` is renamed to `dmbkSoundPlaylists`, following the database-prefix rule (prefix `dmbkSound`, with the repeated "Sound" dropped). No alias is kept. No known client calls the old field: dmbk reads Mongo directly, and lora-trainer doesn't use sound.
- Once both apps read from `dmbk-sound`, `dmbk-photos.sound_snapshots` is dropped.
- Docs (`CLAUDE.md`, `AGENTS.md`, `README.md`, the migration roadmap) list `dmbk-sound` as a third foreign database.

## Capabilities

### New Capabilities
- `sound-playlists`: the cached SoundCloud playlists snapshot. Covers where it is stored (`dmbk-sound.sound_snapshots`), which app owns it, how this API exposes it, and the move out of `dmbk-photos`.

### Modified Capabilities
- `graphql-schema-naming`: adds `dmbkSound` to the database prefixes and renames the `dmbkPhotosSoundPlaylists` query field to `dmbkSoundPlaylists`.

## Impact

- **This repo:** `src/env.ts`, `src/db/mongoose.ts` (`soundDb()`), new `src/models/sound.ts`, `src/models/photos.ts` (sound types and model removed), `src/schema/queries.ts`, `src/schema/types/sound.ts` (import path only), new `scripts/move-sound-snapshots.ts` plus its npm script, and the docs above.
- **dmbk repo:** `src/lib/soundcloud/build-playlists.ts` and `src/server/api/db.ts` (a handle on `dmbk-sound`), plus `.env.example` if a `SOUND_DB_NAME` override is added there.
- **Atlas:** users are scoped per database, so `dmbk-photos-app` (dmbk) and `graphql-api` (this API and its move script) each need `readWrite` on `dmbk-sound`. Without access, dmbk's snapshot write fails silently (it is caught) and this API's query errors out.
- **Clients:** any GraphQL document that uses `dmbkPhotosSoundPlaylists` must switch to `dmbkSoundPlaylists`.
