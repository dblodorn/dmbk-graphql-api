# Migration roadmap: one API for dmbk-photos and lora-trainer

Goal: this API becomes the only read/write path for the content in the `dmbk-photos` and `lora-trainer` databases (Atlas cluster `dmbk-world`). Clients use Relay. The dmbk and lora-trainer apps then stop talking to Mongo directly, and their temporary APIs are deleted.

The one rule throughout: **an app's own endpoint is removed only after its replacement here is live and its clients have moved.** Nothing should ever be left without a way to write.

| Phase | Scope | Status |
|---|---|---|
| 1 | Relay reads, SIWE sign-in, curation mutations | Built, not yet run against live data or deployed |
| 2 | Photo upload and delete | Planned |
| 3 | LoRA training and image generation | Planned (needs investigation first) |
| 4 | Move clients over; delete the apps' GraphQL/tRPC endpoints | Planned |

---

## Phase 1 — finish and ship

Already in the code: `photos`, `keywords`, `loraTrainings` (+ `images`), `soundPlaylists`, `node`/`nodes`, `viewer`; `siweNonce` / `signInWithEthereum`; `updatePhoto`, `setPhotoHidden`, `setLoraTrainingHidden`, `setGeneratedImageHidden`.

Remaining before the first deploy:

- [x] Local `.env` (values from `~/dev/dmbk/.env.local`, fresh `JWT_SECRET`) and live read checks, done 2026-10-09:
  - `photos`: 8 public of 12, CDN URLs resolve, admin-only fields null when anonymous, second page works;
  - `keywords` counts match; `soundPlaylists` returns the snapshot;
  - `loraTrainings`: 14 public of 16, 334 visible images, owner-only fields null when anonymous;
  - `node(id:)` round-trips for `Photo`, `LoraTraining` and `GeneratedImage`.
- [x] Database access: the API uses its own Atlas user, `graphql-api`, with `readWrite` on `dmbk-photos` and `lora-trainer` only, scoped to the `dmbk-world` cluster. The apps' users (`dmbk-photos-app`, `lora-trainer-app2`) can each reach only their own database.
  - An older user, `dmbk-graphql-api`, has `readWriteAnyDatabase` and isn't used by this code. Delete it once nothing else depends on it.
- [ ] Not yet tested: the mutations against live data. This needs a signature from an admin wallet. Signed in as the admin wallet, check that `updatePhoto` changes keyword counts the same way dmbk does (compare the `keywords` collection before and after), and that hide/unhide round-trips.
- [ ] Set the env vars on the droplet before merging: `MONGODB_URI` (the `graphql-api` user), `DO_SPACES_CDN_URL`, `ALLOWED_ADDRESSES`, `SIWE_DOMAINS`, `JWT_SECRET` (generate a separate one for production). Remove `MONGODB_DB_NAME`. The server exits at startup without `MONGODB_URI`, `DO_SPACES_CDN_URL` or (in production) `JWT_SECRET`.
- [ ] Add lora-trainer's domain to `SIWE_DOMAINS`. It isn't cloned locally, so its domain is unknown here.
- [x] Fix `NODE_ENV` in `ecosystem.config.cjs`. It set `development`, which made `JWT_SECRET` optional (falling back to a known dev secret) and returned error details to clients. It now sets `production`, so **`JWT_SECRET` must be in the droplet's `.env` before this deploys**, or the server exits on startup.
- [ ] Configure CORS in `createYoga`. Yoga's default reflects any origin. Restrict it to the dmbk apexes (`dmbk.io`, `dain.kim`, `db13.us`), the lora-trainer domain, `localhost`, and Vercel previews.
- [ ] Support patterns in `SIWE_DOMAINS` (for example `*.vercel.app`), mirroring dmbk's `isAllowedHost`. Without that, sign-in fails on Vercel preview URLs.
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

- `reservePhotoUpload(input: { contentType, byteSize, title?, keywords? })` returns `{ photo, uploadUrl }`.
  - The server generates the UUID and the key; the client PUTs the bytes directly to Spaces. Bytes never pass through this API.
  - The pending photo is only visible to admins.
- `finalizePhoto(input: { id, title?, keywords? })` returns `{ photo, photoEdge }`.
  - `photoEdge` lets the admin list use `@prependEdge`.
  - Any failure marks the record `failed` with a reason rather than leaving it half-promoted.
- `deletePhoto(input: { id })` returns `{ deletedPhotoId }` for `@deleteRecord`.
  - If the record is removed but its stored files are not, return an error that says so; don't report a clean delete.

Needs:

- Env: `DO_SPACES_ENDPOINT` (regional base, **without** the bucket subdomain), `DO_SPACES_REGION`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_BUCKET`.
- Dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp`. Check that sharp's prebuilt binary installs on the droplet (Linux x64) under `npm install --omit=dev`.
- The Space's CORS rules must allow `PUT` from every origin that uploads.

Keep identical to dmbk while both write: keyword normalization, `isCounted`, label registration at reserve time, and `PHOTO_SCHEMA_VERSION` (currently 3).

dmbk's maintenance scripts (`recount-keywords`, `cleanup-pending-photos`, `backfill-grid-derivative`) stay in dmbk for now.

---

## Phase 3 — LoRA training and image generation

**Investigate first.** These files in `dblodorn/lora-trainer` have not been read yet: `src/server/api/features/fal.ts`, `payment.ts`, `storage.ts`, `src/lib/lora-scale.ts`, `src/lib/image-dimensions.ts`, and wherever `trainLora` and Are.na channel lookup live.

Known so far (from `features/lora.ts`, `generate.ts`, `slideshow.ts`):

- **Training.** `createPendingLora` inserts a `pending` record; later, a client-called `lora.complete` mirrors the weights to Spaces (`lora-trainer/loras/{id}/{id}.{ext}`) and backfills the training images into Spaces.
  - Completion is driven by the client today. Decide whether this API should take a fal.ai webhook instead.
- **Generation.** `generate.images` calls `fal.subscribe("fal-ai/flux-lora")` with 4 images per batch.
  - Rate limit: 8 batches per 24 hours per wallet, unless `isPaymentExempt`.
  - Each image is mirrored to `lora-trainer/images/{loraId}/{id}.{ext}`, keeping both `imageUrl` (fal) and `cdnUrl` (Spaces).
  - The call blocks for the whole generation. Decide between a long-running mutation (raise timeouts in Caddy) and returning `pending` records that the client polls or subscribes to.
- **Remaining quota.** `generate.remaining` becomes a `Viewer` field.
- **Slideshow.** `slideshow.randomImages` becomes a query. Unlike the original, it should exclude hidden images and hidden trainings.
- **Covered by Phase 1 already.** lora-trainer's `listHidden`, `listHiddenImages`, `getById` and `listByLora` map to `viewer.loraTrainings`, `viewer.generatedImages`, `node` and `LoraTraining.images`. The new versions don't have the original leaks: anyone could read hidden records or list hidden items by wallet.

Needs: `FAL_KEY`, the Spaces credentials from Phase 2, and the payment-exemption list.

---

## Phase 4 — move the clients, delete the old APIs

Do this per capability, in this order:

1. **dmbk admin gallery reads.**
   - Today it calls dmbk's own `/api/graphql` (`src/server/graphql/`) with hand-written types.
   - Point it at this API with Relay, and add the Relay compiler to dmbk.
   - Admin sign-in moves from better-auth cookies to this API's SIWE token. The admin wallets must be in this API's `ALLOWED_ADDRESSES`.
2. **dmbk admin writes.** Edit, hide, upload (after Phase 2) and delete move from tRPC (`features/photos.ts`) to this API's mutations.
3. **Delete dmbk's temporary API.** Remove `src/server/graphql/`, the `/api/graphql` route, and the tRPC photo procedures whose callers have all moved. Remove better-auth and the SIWE wiring if nothing else uses them.
4. **dmbk public pages.** Today the server components import `src/lib/photos/repository.ts` directly. Decide whether they read this API too, or keep the direct Mongo read as a deliberately read-only path. dmbk's own design doc leaves this open.
5. **lora-trainer.** Move reads, then hide/unhide, then (after Phase 3) training and generation. Then delete its tRPC routers and its direct Mongo access.

Once dmbk no longer writes photos, the "keep in sync with dmbk" notes in `src/lib/photos/keywords.ts` and `CLAUDE.md` can go, and this repo becomes the source of truth for the document shapes.

## Open questions

- Should `loraWeightsUrl` stay public, as it is in lora-trainer, or become owner-only?
- Should the user and session collections in both databases eventually be dropped, once better-auth is gone from both apps?
- Is horizontal scaling ever needed? SIWE nonces live in process memory, which is only correct for the single PM2 process.
