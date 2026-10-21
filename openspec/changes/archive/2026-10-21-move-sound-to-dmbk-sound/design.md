# Design

## Context

- `sound_snapshots` has one writer: dmbk's `src/lib/soundcloud/build-playlists.ts`. On every Next.js build that reaches SoundCloud it `replaceOne({ _id: "playlists" }, …, { upsert: true })`s the listing. When SoundCloud is down it reads that document back as a fallback. It gets the database from `getDb()`, which uses the path segment of `MONGODB_URI` (`dmbk-photos`), so sound data ends up in the photos DB without anyone choosing that.
- Write failures are caught and only logged (`saveSnapshot` never throws), and an unreadable snapshot counts as absent. So a misconfigured database never breaks a dmbk build. It just goes stale or empty without anyone noticing.
- This API reads the document through `SoundSnapshotModel`, registered on `photosDb()` in `src/models/photos.ts`, and serves it as `dmbkPhotosSoundPlaylists`. Nothing writes it here.
- No indexes beyond `_id`. dmbk's `ensureIndexes` doesn't cover sound.
- Mongoose here has `autoCreate`/`autoIndex` off, so this API will never create the new collection. Something else has to.

## Goals / Non-Goals

**Goals:**
- Sound data ends up in `dmbk-sound` with no window where a dmbk build loses its fallback snapshot.
- The move can be repeated and reversed until the final drop.

**Non-Goals:**
- Changing the snapshot's shape, `schemaVersion` or the GraphQL `Sound*` types.
- Moving ownership of the snapshot to this API, or having this API refresh SoundCloud itself.
- Adding any other sound features. `dmbk-sound` is simply where they would go.

## Decisions

**`dmbk-sound` is a database, not a collection.** The request says "collection", but `dmbk-photos` is a database, and the goal is a photos-only `dmbk-photos`. Only a separate database gets there. The collection name inside it stays `sound_snapshots`, so dmbk's code change is limited to which database it opens.

**dmbk stays the owner.** It's the only process with SoundCloud credentials and the only writer. This API stays read-only on `dmbk-sound`, the same way it treats `lora-trainer`. That keeps the CLAUDE.md ownership table honest and means no index or collection management moves here.

**dmbk opens `dmbk-sound` explicitly instead of through a second URI.** In dmbk, add a `getSoundDb()` next to `getDb()` that reuses the same `MongoClient` and calls `client.db(process.env.SOUND_DB_NAME || "dmbk-sound")`. A second `MONGODB_URI`-style variable was considered and rejected: it would mean a second connection pool per serverless instance and one more secret to keep in sync across Vercel environments, for a database on the same cluster.

**This API gets `soundDb()` and `env.soundDbName`**, exactly like `photosDb()`/`loraDb()` (`useDb(..., { useCache: true })` on the shared connection). The model moves to `src/models/sound.ts` so `models/photos.ts` describes `dmbk-photos` only, as its header comment says. The sound types (`SoundSnapshotDoc`, `SoundPlaylist`, …) move with it. `schema/types/sound.ts` keeps its content and only changes its import path.

**The move script lives in this repo** (`scripts/move-sound-snapshots.ts`, `npm run move:sound-snapshots`). It follows `backfill-owner-id.ts`: it only reports by default, `--apply` writes, and it's safe to re-run. It uses the raw driver handles (`mongoose.connection.useDb(...).collection('sound_snapshots')`) instead of Mongoose models: it has to read the old location after the model has moved, and it has to create the target collection, which `autoCreate: false` prevents through models. Copy rule: insert the source document if the target has none, and replace the target only if the source's `fetchedAt` is strictly newer. ISO-8601 strings compare correctly as strings. `--drop-source` drops `dmbk-photos.sound_snapshots` only after re-reading both and confirming the target exists with `fetchedAt` ≥ source. Otherwise it exits non-zero. dmbk is a separate repo, so putting the script here keeps the database steps with the API team's runbook. dmbk only needs its code change.

**Rename the query to `dmbkSoundPlaylists` with no alias.** The `graphql-schema-naming` spec requires the prefix to match the database and forbids deprecated aliases. A repo search of dmbk and lora-trainer finds no client for the field, so the break costs nothing. The `SoundSnapshot` return type and the types under it keep their names, so client fragments still work.

## Risks / Trade-offs

- [Atlas users are scoped per database (roadmap: `graphql-api` has `readWrite` on `dmbk-photos` and `lora-trainer` only, and `dmbk-photos-app` reaches only `dmbk-photos`), so neither can touch `dmbk-sound` yet] → Grant `dmbk-photos-app` `readWrite` on `dmbk-sound`. Grant `graphql-api` `readWrite` on it too: the API code only reads, but the move script runs with this repo's credentials and has to write the target. Do this before anything deploys. Because dmbk swallows write errors, confirm after its deploy that `fetchedAt` in `dmbk-sound` advanced. A build log line alone isn't proof.
- [dmbk deploys before the copy, then SoundCloud fails] → `/sound` would publish without Recordings. Mitigation: the copy runs first. Even if it doesn't, the first successful build fills the target.
- [A dmbk preview or old branch build still running the old code keeps writing `dmbk-photos.sound_snapshots` after the switch] → Harmless until the drop. Afterwards an old build would recreate the collection by upsert. Drop only once no old preview builds are expected, and check for and re-drop a recreated collection in the final verification.
- [This API deploys before the copy] → `dmbkSoundPlaylists` returns `null` (allowed by the spec) until the copy runs. Run the copy first anyway.

## Migration Plan

1. In Atlas, grant `readWrite` on `dmbk-sound` to `dmbk-photos-app` and `graphql-api`.
2. `npm run move:sound-snapshots` (report), then `-- --apply`. Verify the copy.
3. Merge and deploy the dmbk change (writes and reads `dmbk-sound`). Trigger a build and confirm `fetchedAt` advanced in `dmbk-sound`.
4. Merge this repo's change to `main` (deploys automatically). Confirm `dmbkSoundPlaylists` on production returns the snapshot.
5. Re-run `-- --apply` in case a build between steps 2 and 3 wrote to the old location. It never regresses the target.
6. `-- --drop-source`. Confirm `dmbk-photos` lists only `photos` and `keywords` (plus the legacy SIWE collections CLAUDE.md mentions).

Rollback before step 6: revert either repo. The old collection is still there, and the other side keeps working. After step 6, roll back by copying the document back the other way with the same script logic.
