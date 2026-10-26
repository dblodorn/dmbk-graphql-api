# Migration roadmap: one API for dmbk-photos and lora-trainer

Goal: this API becomes the only read/write path for the content in the `dmbk-photos` and `lora-trainer` databases (Atlas cluster `dmbk-world`). Clients use Relay. The dmbk and lora-trainer apps then stop talking to Mongo directly, and their temporary APIs are deleted.

The one rule throughout: **an app's own endpoint is removed only after its replacement here is live and its clients have moved.** Nothing should ever be left without a way to write.

| Phase | Scope | Status |
|---|---|---|
| 1 | Relay reads, SIWE sign-in, curation mutations | Deployed 2026-10-20 at `graphql.dmbk.network` |
| 1.5 | Google accounts owned by this API; remove SIWE and lora-trainer's crypto payments | Done 2026-10-21 — `openspec/changes/archive/2026-10-21-google-accounts/` |
| 2 | Photo upload and delete | Deployed 2026-10-20 |
| 3 | LoRA training and image generation (records only; fal.ai stays in lora-trainer) | In progress — `openspec/changes/lora-trainer-writes/` |
| 4 | Move clients over; delete the apps' GraphQL/tRPC endpoints | In progress — dmbk admin writes moved (step 2) |

**Phase 1.5 comes before Phase 4's client moves.** It replaces SIWE everywhere: the API signs people in with Google (`signInWithGoogle`), admins are `ADMIN_EMAILS`, LoRA records are owned by `ownerId`, and lora-trainer's crypto payments are removed rather than ported. Phase 1's checklist below is history and still names the SIWE setup it shipped with.

---

## Phase 1 — finish and ship

Already in the code: `dmbkPhotos`, `dmbkPhotosKeywords`, `loraTrainerTrainings` (+ `images`), `dmbkSoundPlaylists`, `node`/`nodes`, `viewer` (+ `loraTrainerTrainings`, `loraTrainerImages`); `siweNonce` / `signInWithEthereum`; `dmbkPhotosUpdatePhoto`, `dmbkPhotosSetPhotoHidden`, `loraTrainerSetTrainingHidden`, `loraTrainerSetImageHidden`.

Naming (2026-10-20): fields that touch a database are prefixed with its camelCase name (`dmbkPhotos…` / `loraTrainer…`); the names in the checks below are the current ones, except `dmbkPhotosSoundPlaylists`, which became `dmbkSoundPlaylists` when the snapshot moved to `dmbk-sound` (below). New fields in Phases 2–3 follow the same rule.

Remaining before the first deploy:

- [x] Local `.env` (values from `~/dev/dmbk/.env.local`, fresh `JWT_SECRET`) and live read checks, done 2026-10-09:
  - `dmbkPhotos`: 8 public of 12, CDN URLs resolve, admin-only fields null when anonymous, second page works;
  - `dmbkPhotosKeywords` counts match; `dmbkPhotosSoundPlaylists` returns the snapshot;
  - `loraTrainerTrainings`: 14 public of 16, 334 visible images, owner-only fields null when anonymous;
  - `node(id:)` round-trips for `Photo`, `LoraTraining` and `GeneratedImage`.
- [x] Database access: the API uses its own Atlas user, `graphql-api`, with `readWrite` on `dmbk-photos` and `lora-trainer` only, scoped to the `dmbk-world` cluster. The apps' users (`dmbk-photos-app`, `lora-trainer-app2`) can each reach only their own database.
  - `dmbk-sound` (2026-10-21): `graphql-api` and `dmbk-photos-app` each need `readWrite` on it as well (see "Sound snapshot → dmbk-sound").
  - An older user, `dmbk-graphql-api`, has `readWriteAnyDatabase` and isn't used by this code. Delete it once nothing else depends on it.
- [x] Mutations tested against live data (2026-10-20) with `npm run test:mutations`: SIWE sign-in and refusals, `dmbkPhotosUpdatePhoto` keyword normalization and counts, hide/unhide counts and visibility, and LoRA owner/non-owner hide on temporary fixtures. Everything is restored afterwards.
  - Shared with dmbk, not fixed: hiding the last photo that carries a keyword deletes that keyword's entry, and unhiding recreates it with the slug as its label. The display label is lost (`Baja` becomes `baja`). Fix it in both repos or neither.
- [x] Set the env vars on the droplet before merging (done 2026-10-20, production `JWT_SECRET` generated on the droplet): `MONGODB_URI` (the `graphql-api` user), `DO_SPACES_CDN_URL`, `ALLOWED_ADDRESSES`, `SIWE_DOMAINS`, `JWT_SECRET` (generate a separate one for production). Remove `MONGODB_DB_NAME`. The server exits at startup without `MONGODB_URI`, `DO_SPACES_CDN_URL` or (in production) `JWT_SECRET`.
- [x] Add lora-trainer's domain to `SIWE_DOMAINS`: it's `arenatrainer.dmbk.io`, covered by `*.dmbk.io`. Local `.env` now has `dmbk.io,*.dmbk.io,dain.kim,*.dain.kim,db13.us,localhost:3000`; the droplet's `.env` needs the same.
- [x] Fix `NODE_ENV` in `ecosystem.config.cjs`. It set `development`, which made `JWT_SECRET` optional (falling back to a known dev secret) and returned error details to clients. It now sets `production`, so **`JWT_SECRET` must be in the droplet's `.env` before this deploys**, or the server exits on startup.
- [x] Configure CORS in `createYoga`. It now allows only origins whose host matches `SIWE_DOMAINS` (https, or http for localhost), with credentials off since auth is a bearer token.
- [x] Support patterns in `SIWE_DOMAINS` (`*.dmbk.io`), mirroring dmbk's `isAllowedHost` (`src/lib/hosts.ts`).
  - [ ] Vercel previews still can't sign in. `*.vercel.app` was left out on purpose, because anyone can deploy there and get a signature that works here. (That was about SIWE. Since Phase 1.5, `ALLOWED_ORIGINS` is CORS only, with bearer tokens and credentials off, so `*.vercel.app` was added to it on 2026-10-21 for dmbk's preview galleries. Google sign-in on previews is a separate limit: Google's authorized JavaScript origins.) Options: put previews on a custom subdomain such as `*.preview.dmbk.io`, or list specific preview hosts.
- [ ] Optional: quiet Yoga's `ERR` logging for expected domain errors such as failed sign-ins and forbidden calls, so real failures stand out in the PM2 logs.

---

## Phase 2 — photo upload and delete

Port from dmbk (`dblodorn/dmbk`):

| Source | What it holds |
|---|---|
| `src/server/api/features/photos.ts` | `reserveUpload`, `finalizeUpload`, `delete` — the flow to replicate |
| `src/lib/photos/repository.ts` | `createPendingPhoto`, `promoteToReady`, `markPhotoFailed`, `deletePhoto` |
| `src/lib/photos/derivatives.ts` | `inspectImage`, `makeThumb` / `makeGrid` / `makeDisplay` (sharp), `MAX_ORIGINAL_BYTES` |
| `src/lib/photos/constants.ts` | Supported content types and size limits (shared with the admin form) |
| `src/lib/spaces/client.ts` | `presignUpload`, `headObject`, `getObject`, `putObject`, `deletePhotoObjects` |
| `src/lib/spaces/keys.ts` | `photos/{id}/original.{ext}`, `display.webp`, `grid.webp`, `thumb.webp` |

Relay mutations:

- `dmbkPhotosReservePhotoUpload(input: { contentType, byteSize, title?, keywords? })` returns `{ photo, uploadUrl }`.
  - The server generates the UUID and the key; the client PUTs the bytes directly to Spaces. Bytes never pass through this API.
  - The pending photo is only visible to admins.
- `dmbkPhotosFinalizePhoto(input: { id, title?, keywords? })` returns `{ photo, photoEdge }`.
  - `photoEdge` lets the admin list use `@prependEdge`.
  - Any failure marks the record `failed` with a reason rather than leaving it half-promoted.
- `dmbkPhotosDeletePhoto(input: { id })` returns `{ deletedPhotoId }` for `@deleteRecord`.
  - If the record is removed but its stored files are not, return an error that says so; don't report a clean delete.

Needs:

- Env: `DO_SPACES_ENDPOINT` (regional base, **without** the bucket subdomain), `DO_SPACES_REGION`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_BUCKET`.
- Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp`. Check that sharp's prebuilt binary installs on the droplet (Linux x64) under `npm install --omit=dev`.
- The Space's CORS rules must allow `PUT` from every origin that uploads.

Keep identical to dmbk while both write: keyword normalization, `isCounted`, label registration at reserve time, and `PHOTO_SCHEMA_VERSION` (currently 3).

dmbk's maintenance scripts (`recount-keywords`, `cleanup-pending-photos`, `backfill-grid-derivative`) stay in dmbk for now.

Progress (OpenSpec change `port-photo-upload-and-delete`):

- [x] Spaces env vars set on the droplet, 2026-10-20 (backup `.env.bak-20261020-200306`). They're required at startup now.
- [x] The three mutations, with `npm run test:mutations` passing against the real Space: reserve → PUT → finalize, EXIF orientation, failure recording, delete with counts and storage, and a forced storage-cleanup failure.
- [x] Deployed 2026-10-20 (#11). `require('sharp')` loads on the droplet (libvips 8.18.7), PM2 is online, and production lists the three mutations.
- Differences from dmbk, on purpose:
  - Finalize runs one photo at a time and its derivatives one after another, to fit the 2 GB droplet.
  - A delete whose storage cleanup fails returns `STORAGE_CLEANUP_FAILED`, not a generic error.
  - AVIF actually finalizes. sharp reports AVIF as `heif`, and dmbk's format map lacks it, so **dmbk rejects AVIF at finalize** even though it accepts it at reserve. Fix that in dmbk too (map `heif` with `av1` compression to `image/avif`).

---

## Phase 3 — LoRA training and image generation

**Decided 2026-10-23** (OpenSpec change `lora-trainer-writes`, with lora-trainer's `adopt-relay-graphql-client`): the fal.ai calls and the Spaces mirroring **stay in lora-trainer**, which keeps them as its own tRPC procedures. This API only records what they produced. So:

- No `FAL_KEY` here, and no generation call in this API: the "long-running mutation or polled `pending` records" question is moot. lora-trainer's procedure blocks on fal.ai as it does today.
- Completion stays client-driven (no fal.ai webhook): lora-trainer polls fal.ai, mirrors the weights, then calls `loraTrainerCompleteTraining`.
- Spaces key layout is unchanged, so image ids are chosen by lora-trainer (it keys `lora-trainer/images/{loraId}/{id}.{ext}` before recording).

Shipped by `lora-trainer-writes`:

- [x] `loraTrainerCreateTraining`, `loraTrainerSetTrainingAssets`, `loraTrainerCompleteTraining`, `loraTrainerRecordImages` (signed in, owner rules as for hiding, URL rules in `lib/lora/urls.ts`).
- [x] `viewer.loraTrainerTrainingByRequestId(requestId)`, for completion after a reload.
- [x] `loraTrainerSlideshowImages(count)`: excludes hidden images and hidden or unfinished trainings, unlike the original.
- **Covered by Phase 1 already.** lora-trainer's `listHidden`, `listHiddenImages`, `getById` and `listByLora` map to `viewer.loraTrainerTrainings(visibility: HIDDEN)`, `viewer.loraTrainerImages(visibility: HIDDEN)`, `node` and `LoraTraining.images`. The new versions don't have the original leaks: anyone could read hidden records or list hidden items by wallet.
- **Not now.** `viewer.loraTrainerRemainingGenerations` (quotas come back only with open sign-up and payments, keyed on `ownerId`) and a `failed` status transition.

---

## Phase 4 — move the clients, delete the old APIs

Do this per capability, in this order:

1. **dmbk admin gallery reads.** ✅ Done 2026-10-21 (dmbk OpenSpec change `reads-through-graphql-api`, dblodorn/dmbk#37): the library and edit view read through Relay over dmbk's `/api/admin/graphql` proxy.
   - Today it calls dmbk's own `/api/graphql` (`src/server/graphql/`) with hand-written types.
   - Point it at this API with Relay, and add the Relay compiler to dmbk.
   - Admin sign-in has already moved to this API's Google sessions in Phase 1.5.
2. **dmbk admin writes.** Edit, hide, upload (after Phase 2) and delete move from tRPC (`features/photos.ts`) to this API's mutations.
   - Before switching upload over, confirm the Space's CORS rules allow `PUT` from every admin origin (`dmbk.io`, previews, `localhost:3000`). The browser PUTs straight to the `uploadUrl`.
   - Progress (dmbk OpenSpec change `admin-writes-through-graphql-api`): upload, edit, hide and the new delete all call this API's mutations through a same-origin proxy in dmbk (`/api/admin/graphql`), which forwards only Relay persisted operations with the session token from dmbk's HTTP-only cookie. dmbk's tRPC write procedures are deleted, along with its Spaces client and sharp derivatives, and AVIF now finalizes from the admin. dmbk's `pnpm verify:admin` drives its screens against a local server here, using `npm run test:mutations -- --admin-token` for its sessions. Relay is in dmbk for writes only: reads (step 1) and deleting dmbk's `/api/graphql` and tRPC read procedures (step 3) remain.
3. **Delete dmbk's temporary API.** ✅ Done 2026-10-21 (dmbk#37): `/api/graphql`, `/api/trpc`, the tRPC router and `lib/photos/repository.ts` are gone. Remove `src/server/graphql/`, the `/api/graphql` route, and the tRPC photo procedures whose callers have all moved. (better-auth and the SIWE wiring are already gone, in Phase 1.5.)
4. **dmbk public pages.** ✅ Decided and done 2026-10-21 (dmbk#37): they read this API. `/photos` renders its first page on the server from `dmbkPhotos` and the browser pages against the API directly (CORS admits `dmbk.io`, `*.dmbk.io` and `*.vercel.app`). `/sound`'s fallback reads `dmbkSoundPlaylists`. dmbk no longer opens `dmbk-photos`; its `dmbk-photos-app` user has `readWrite` on `dmbk-sound` only, for the build's snapshot write. The `dmbk-photos` indexes are this API's now (#21).
5. **lora-trainer.** One change in that repo, `adopt-relay-graphql-client`, after Phase 3 ships: reads and hide/unhide through Relay over a same-origin proxy, its fal.ai procedures persisting through the Phase 3 mutations, then its Mongo access and the non-fal.ai tRPC routers deleted. After a week with no rollback, remove `lora-trainer-app2`'s Atlas access.

Once dmbk no longer writes photos, the "keep in sync with dmbk" notes in `src/lib/photos/keywords.ts` and `CLAUDE.md` can go, and this repo becomes the source of truth for the document shapes.

## Sound snapshot → dmbk-sound

`dmbk-photos` is for photos only. The SoundCloud snapshot (`sound_snapshots`, written by dmbk's `src/lib/soundcloud/build-playlists.ts`) moves to its own database, `dmbk-sound`, still owned by dmbk. This API reads it as `dmbkSoundPlaylists` (formerly `dmbkPhotosSoundPlaylists`). OpenSpec change: `move-sound-to-dmbk-sound`.

- [x] Atlas: `readWrite` on `dmbk-sound` for `graphql-api` and `dmbk-photos-app` (2026-10-21).
- [x] `npm run move:sound-snapshots -- --apply` copies the snapshot (2026-10-21).
- [x] dmbk writes and reads the snapshot in `dmbk-sound` (dmbk #36, 2026-10-21), and a production build advances its `fetchedAt` there.
- [x] This API reads `dmbk-sound` (deployed 2026-10-21, #15).
- [x] `npm run move:sound-snapshots -- --drop-source` drops `dmbk-photos.sound_snapshots` (dropped 2026-10-21). It can't come back: `dmbk-photos-app` lost `dmbk-photos` access the same day, and the collection was confirmed still absent.

## Client API keys

Every client app sends its own `X-API-Key`; requests without one become the rate-limited, read-only playground once `API_KEYS_ENFORCED=true`. OpenSpec change: `lock-api-to-clients` (its tasks, section 6, carry the verification for each step).

- [x] Deploy the API with `API_KEYS_ENFORCED` unset, after `ss -ltnp` on the droplet confirms nothing but Caddy needs `:4000` from outside (production now binds to `127.0.0.1`).
- [x] Issue production keys (`npm run api-client -- create <client>`) and set `DMBK_GRAPHQL_API_KEY` in each Vercel project.
- [x] dmbk-photo sends its key from the server, and its gallery's browser reads go through a same-origin `/api/photos` route.
- [x] lora-trainer sends its key.
- [x] dmbk sends its key from the `/sound` fallback.
- [x] `[api-access] keyless request` in `pm2 logs` shows only expected callers for a day.
- [x] Set `API_KEYS_ENFORCED=true` in the droplet's `.env` and `pm2 restart graphql-api --update-env`.

---

## Open questions

- Should `loraWeightsUrl` stay public, as it is in lora-trainer, or become owner-only?
- Should the user and session collections in both databases eventually be dropped, once better-auth is gone from both apps?
- Is horizontal scaling ever needed? Sessions are in `dmbk-accounts`, so auth no longer pins the API to one process.
