# Design

## Context

- dmbk's flow (`src/server/api/features/photos.ts` → `reserveUpload`, `finalizeUpload`, `delete`) is the reference. Its helpers live in `src/lib/spaces/{client,keys}.ts`, `src/lib/photos/{constants,derivatives}.ts` and the repository functions `createPendingPhoto`, `promoteToReady`, `markPhotoFailed` and `deletePhoto`.
- This API already has, ported verbatim and shared with dmbk: `PhotoModel`/`KeywordModel`, `PHOTO_SCHEMA_VERSION`, `normalizeTitle`, `normalizeKeywords`, `registerKeywordLabels`, `applyKeywordDelta` and the `isCounted` rule. `updatePhoto` and `setPhotoHidden` show the pattern (Mongoose `lean()` docs, `requirePhoto`, counts adjusted after the write).
- Auth is Google accounts now. The `admin` scope is `viewer.isAdmin`, and scope-auth refusals surface as `FORBIDDEN`.
- `maskError` only passes through domain errors listed in `CODES`. dmbk's partial-delete error is a generic internal error, which this API would mask as "Unexpected error".
- Production is one droplet with 2 GB RAM and 1 vCPU (x86_64). PM2 runs a single process, about 130 MB at rest. Its `.env` has `DO_SPACES_CDN_URL` but none of the other Spaces variables. dmbk's `.env.local` has all five (`ENDPOINT`, `REGION`, `KEY`, `SECRET`, `BUCKET`).

## Goals / Non-Goals

**Goals:**
- Port the three operations so they behave identically to dmbk against the same database and Space, so either app can finalize or delete a photo the other reserved.
- Keep resolvers thin: storage, image and repository logic live under `src/lib/`, and the schema layer only maps inputs and payloads.
- Stay within the droplet's memory under the worst case: a 50 MB original at the maximum pixel count.

**Non-Goals:**
- Background or queued processing. Finalize stays synchronous in the request, as in dmbk.
- Retrying failed photos or cleaning up abandoned pending ones. dmbk's `cleanup-pending-photos` script still covers the shared collection.
- Batch upload. A batch is N independent reserve → PUT → finalize sequences on the client.

## Decisions

**Module layout mirrors dmbk.**
- `src/lib/spaces/client.ts` and `src/lib/spaces/keys.ts` take dmbk's code nearly verbatim (presign, put, get, head, delete; the `photos/` key layout).
- `src/lib/photos/images.ts` combines dmbk's `constants.ts` and `derivatives.ts`. The client-bundle split dmbk needed doesn't apply here.
- The repository gains `createPendingPhoto`, `getPhotoDoc`, `promoteToReady`, `markPhotoFailed` and `deletePhoto`.
- A thin orchestration module, `src/lib/photos/upload.ts`, holds `reservePhotoUpload`, `finalizePhoto` and `deletePhotoWithFiles`, so the logic that dmbk keeps in its tRPC procedures doesn't end up in resolvers.
- Matching file names make a later side-by-side diff with dmbk easy. Alternative considered: everything in `repository.ts`. Rejected because storage and sharp don't belong next to Mongo filters.

**Spaces config is required at startup.** `env.ts` gains the five `DO_SPACES_*` variables through `required()`, so a deploy without them exits immediately instead of failing on the first upload. The S3 client strips a `<bucket>.` subdomain from the endpoint, as dmbk does, because dmbk's `.env.local` value may carry it. With `forcePathStyle` the bucket would otherwise appear twice in the URL. Alternative considered: optional config, with the mutations returning an error when it's missing. Rejected because the server would look healthy while being unable to upload.

**`contentType` is a `String` validated by the repository, not a GraphQL enum.** An enum would turn a bad value into `GRAPHQL_VALIDATION_FAILED` before the resolver runs. The spec requires `BAD_USER_INPUT`, which matches how `byteSize` and keyword errors surface, and lets the admin form show one kind of error. Validation throws `InvalidInputError`, which is already mapped to `BAD_USER_INPUT`.

**Image errors use `InvalidInputError` too.** dmbk's `InvalidImageError` maps to the same client-facing outcome, so the port throws `InvalidInputError` rather than adding a class that maps to the same code.

**Payload shapes:**
- Reserve returns `{ photo, uploadUrl }`.
- Finalize returns `{ photo, photoEdge }`, where `photoEdge` is `{ cursor, node }` built with the same `cursorFor` that `toConnection` uses. That requires an edge type. Pothos' relay plugin has no public helper for an edge outside a connection, so the design defines a small `DmbkPhotosPhotoEdge` object type (`cursor: String!`, `node: Photo!`). That matches what `@prependEdge` needs.
- Delete returns `{ deletedPhotoId: ID! }`, the encoded global ID (`encodeGlobalID('Photo', id)`), because `@deleteRecord` matches on store IDs.

**Finalize state machine (as dmbk):**
1. Load the doc. Missing → `NOT_FOUND`. Not `pending` → `BAD_USER_INPUT` with no state change.
2. `headObject(originalKey)`. Missing → mark `failed` ("Upload was never completed; no object at the key.") and return `BAD_USER_INPUT`.
3. Inside one try block: get the bytes, inspect, build the derivatives, put the derivatives, then `promoteToReady`. Any throw marks the photo `failed` with the error's message, then rethrows. `InvalidInputError` shows as `BAD_USER_INPUT`. Storage or sharp failures are masked as unexpected, but the photo is still recorded as failed.

`promoteToReady` replaces the whole document, applies the keyword delta only if the photo is counted, and supports `replaceTitle`/`replaceKeywords` exactly as dmbk does.

**Memory: process derivatives one at a time, and one finalize at a time.**
- dmbk runs the three resizes with `Promise.all` on Vercel, where each request gets its own function instance. Here every request shares one 2 GB box.
- A 50 MB JPEG can decode to hundreds of MB of pixels per sharp pipeline, so three at once plus the buffer could push the process far beyond its current ~130 MB.
- The port therefore:
  - runs thumb, grid and display one after another;
  - sets `sharp.concurrency(1)` and `sharp.cache(false)` at module load;
  - wraps finalize in an in-process mutex, so a batch of 10 is processed one photo at a time.
- Output is byte-identical, and only latency changes. Alternative considered: keeping `Promise.all`. Rejected because of the risk of the OOM killer taking down the whole API.

**Delete:**
1. `deletePhoto` (repository) removes the record and decrements counts if the photo was counted, then returns the four recorded keys.
2. The orchestrator calls `deletePhotoObjects(keys)`, which filters out nulls, deletes each key, and treats a missing key as success.
3. If storage fails, it throws a new `StorageCleanupError` (registered in `CODES` as `STORAGE_CLEANUP_FAILED`) and logs the photo id.

Record first, files second, as in dmbk: a stray file is harmless, but a record pointing at missing files would break the gallery. It never deletes by prefix.

**Dependencies.** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `sharp` go in `dependencies`, because prod runs `npm ci --omit=dev`. sharp ≥0.33 installs a prebuilt `linux-x64` binary through optional dependencies, and `package-lock.json` must be generated with those optional platform packages included. Verify after deploy with `node -e "require('sharp')"` on the droplet.

**Testing.** `scripts/test-mutations.ts` gains a photo-upload suite that runs against the real Space. It generates a small JPEG with sharp, one with EXIF orientation 6, and a non-image file. For each, it reserves, PUTs to `uploadUrl`, and finalizes. It checks status, dimensions, CDN URLs, count deltas and the failure cases, then deletes every fixture and confirms the objects are gone. Fixtures use a dedicated keyword, so `--cleanup` can find and delete leftovers.

## Risks / Trade-offs

- **[Both apps write the same documents and keys during the migration.]** Keep the key layout, schemaVersion, keyword logic and failure semantics identical to dmbk. `CLAUDE.md` already requires changes to land in both repos.
- **[The Space's CORS rules don't allow `PUT` from the admin origin.]** Uploads from the browser would fail before reaching this API. Check the Space's CORS config before switching dmbk's admin over, and note it in the roadmap. The test script PUTs from Node, so it won't catch this.
- **[sharp doesn't load on the droplet (wrong platform package in the lockfile).]** The server would crash on the first import, and the deploy health check would fail and stop the deploy. Generate the lockfile normally on macOS (npm records every platform's optional packages), then confirm `require('sharp')` in production.
- **[The finalize mutex makes a batch of 10 large photos slow (tens of seconds each).]** That's acceptable for an admin-only flow. The admin form already tracks per-file progress, and Caddy's default timeouts don't cut off requests.
- **[The presigned URL is good for 15 minutes.]** A slow upload of a 50 MB file over a poor connection could expire mid-PUT. That's the same limit dmbk has, and the photo stays `pending` for a retry or cleanup.
- **[The delete removes the record and then fails to remove the files.]** The objects are orphaned. `STORAGE_CLEANUP_FAILED` plus the server log give the id, and cleanup is a manual delete in the Space.

## Migration Plan

1. Set `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_KEY`, `DO_SPACES_SECRET` and `DO_SPACES_BUCKET` in the droplet's `.env` (values from dmbk). This must happen **before** the merge, because the new `required()` checks would stop the server from starting.
2. Locally: `npm run typecheck`, then `npm run test:mutations` against the real Space.
3. Merge and deploy. On the droplet, confirm `require('sharp')` loads and the PM2 process is healthy.
4. Rollback: revert the merge. The extra env vars are harmless to the old code. Photos created through the API are ordinary dmbk documents that dmbk can still serve and delete.

## Open Questions

- Whether the Space's current CORS rules already allow `PUT` from `dmbk.io` / `localhost:3000`. dmbk's admin uploads work today, so they probably do. This only matters at Phase 4 cutover, so confirm it then.
