# Tasks

## 1. Access and current state

- [x] 1.1 In Atlas (cluster `dmbk-world`), grant `readWrite` on `dmbk-sound` to `dmbk-photos-app` and `graphql-api`. Verify both users' roles list `dmbk-sound` in the Atlas UI or `atlas dbusers describe`.
  - `graphql-api`: done 2026-10-21 (roles `dmbk-photos`, `lora-trainer`, `dmbk-accounts`, `dmbk-sound`; scope `dmbk-world` kept). `dmbk-photos-app`: done 2026-10-21 (roles `dmbk-photos`, `dmbk-sound`).
- [x] 1.2 Record the current state: `dmbk-photos.sound_snapshots` document count (expect 1, `_id: "playlists"`), its `fetchedAt` and `schemaVersion`, and confirm `dmbk-sound` doesn't exist yet. Note the values in the PR description.
  - Recorded 2026-10-21: 1 document, `_id: "playlists"`, `fetchedAt: 2026-10-20T23:59:44.436Z`, `schemaVersion: 1`, 14 playlists. `graphql-api` is refused `listCollections` on `dmbk-sound` (task 1.1 is needed).

## 2. API: read from dmbk-sound

- [x] 2.1 Add `soundDbName: process.env.SOUND_DB_NAME || 'dmbk-sound'` to `src/env.ts` (documented as owned by dmbk, read-only here) and `soundDb()` to `src/db/mongoose.ts` next to `photosDb()`/`loraDb()`. Verify with `npm run typecheck`.
- [x] 2.2 Create `src/models/sound.ts` holding `SoundSnapshotDoc`, `SoundUser`, `SoundTrack`, `SoundPlaylist`, the schema (`collection: 'sound_snapshots'`) and `SoundSnapshotModel` on `soundDb()`, with a header comment naming dmbk's `src/lib/soundcloud/build-playlists.ts` as the writer. Remove all of these from `src/models/photos.ts`. Verify `grep -n Sound src/models/photos.ts` finds nothing and typecheck passes.
- [x] 2.3 Point `src/schema/types/sound.ts` and `src/schema/queries.ts` at `models/sound.js`, and rename the query field `dmbkPhotosSoundPlaylists` → `dmbkSoundPlaylists` (same type, `nullable: true`, same description). Verify with typecheck and a repo-wide grep (excluding `node_modules`, `openspec/changes/archive`) that finds `dmbkPhotosSoundPlaylists` only in this change's artifacts.

## 3. Move script

- [x] 3.1 Write `scripts/move-sound-snapshots.ts` per design.md: it reports by default, `--apply` copies using raw collection handles (insert if the target is missing, replace only if the source `fetchedAt` is strictly newer), and `--drop-source` drops `dmbk-photos.sound_snapshots` only when the target's `fetchedAt` ≥ the source's (otherwise it exits non-zero). Read DB names from `env`. Add `"move:sound-snapshots": "tsx --env-file=.env scripts/move-sound-snapshots.ts"` to `package.json`. Verify typecheck passes (it covers `scripts/`).
- [x] 3.2 Exercise the script against a scratch database pair before touching production: run with `PHOTOS_DB_NAME`/`SOUND_DB_NAME` pointed at throwaway DBs seeded with a copy of the snapshot. Confirm that the report-only run writes nothing, `--apply` produces an identical document, a re-run with an older source leaves the target unchanged, and `--drop-source` is refused while the target is missing. Drop the scratch DBs afterwards.
  - Done against a throwaway in-memory mongod (the `graphql-api` user can't create scratch DBs on Atlas), seeded with the real snapshot. Every case passed, a refused drop exits 1, and `--apply --drop-source` together is rejected. A local API on the same server served `dmbkSoundPlaylists`, returned `null` once the document was gone, and rejected `dmbkPhotosSoundPlaylists` with `GRAPHQL_VALIDATION_FAILED`.

## 4. Docs

- [x] 4.1 Update `CLAUDE.md` and `AGENTS.md`: add a `dmbk-sound` / `sound_snapshots` / dmbk row to the database table, remove `sound_snapshots` from the `dmbk-photos` row, add `SOUND_DB_NAME` to the env list, add `dmbkSound…` to the prefix rule, and add the move script to Commands. Verify by reading the diff.
- [x] 4.2 Update `README.md` (intro paragraph, prefix sentence, query table → `dmbkSoundPlaylists`, `.env` docs if listed) and `docs/plans/2026-10-08-migration-roadmap.md` (field lists, the `graphql-api` user's database scope, a line recording the move). Verify `grep -rn "dmbkPhotosSoundPlaylists" README.md docs CLAUDE.md AGENTS.md` finds only the roadmap's dated Phase 1 check and the notes that explain the rename.

## 5. dmbk repo (separate PR in `/Users/dmbk/dev/dmbk`)

- [x] 5.1 In dmbk's `src/server/api/db.ts`, add `getSoundDb()`, which reuses the `getDb()` client and opens `process.env.SOUND_DB_NAME || "dmbk-sound"`. Switch `snapshots()` in `src/lib/soundcloud/build-playlists.ts` to it, update that file's comment, and document the optional `SOUND_DB_NAME` in `.env.example`. Verify with dmbk's typecheck/build.
  - On dmbk branch `chore/sound-snapshot-to-dmbk-sound` (uncommitted). `tsc --noEmit` and eslint on the touched files pass. The full `pnpm build` was not run. Also updated dmbk's `CLAUDE.md`.

## 6. Rollout (in order)

- [x] 6.1 Run `npm run move:sound-snapshots` (report), then `-- --apply` against production. Verify the `dmbk-sound.sound_snapshots` document is identical to the one recorded in 1.2.
  - Done 2026-10-21. A dmbk build had refreshed the source since 1.2, so the copied document is `fetchedAt 2026-10-21T16:31:37.260Z`, `schemaVersion 1`, 14 playlists, deep-equal to the source. A re-run reports nothing to do.
- [ ] 6.2 Merge and deploy the dmbk PR, then trigger a production build. Verify `fetchedAt` in `dmbk-sound` advanced past the 1.2 value and `/sound` lists Recordings.
- [ ] 6.3 Merge this repo's PR to `main` (auto-deploys). Verify on `https://graphql.dmbk.network/graphql` that `{ dmbkSoundPlaylists { fetchedAt } }` returns the value from 6.2 and `dmbkPhotosSoundPlaylists` fails validation.
- [ ] 6.4 Re-run `-- --apply` (catches a build that wrote to the old location between 6.1 and 6.2, and must report "target is newer, nothing to do"), then `-- --drop-source`. Verify `dmbk-photos` lists no `sound_snapshots` collection.
- [ ] 6.5 A day or more later, after any old dmbk preview builds have aged out, confirm `dmbk-photos.sound_snapshots` hasn't been recreated. Drop it again if it has, then tick the roadmap line.
