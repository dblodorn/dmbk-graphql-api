# Proposal

## Why

The API can already edit and hide photos, but adding and removing them still only works through dmbk's tRPC router (`reserveUpload`, `finalizeUpload`, `delete` in `src/server/api/features/photos.ts`). Until those are ported too, dmbk's admin can't move to this API (roadmap Phase 4, step 2), and dmbk has to keep its own photo write path and Spaces credentials. This is Phase 2 of the migration roadmap.

## What Changes

- New admin-only Relay mutation `dmbkPhotosReservePhotoUpload(input: { contentType, byteSize, title?, keywords? })`. It creates a `pending` photo with a server-generated UUID and returns that photo and a short-lived presigned PUT URL for the original. The client uploads the bytes straight to DigitalOcean Spaces; they never pass through the API.
- New admin-only Relay mutation `dmbkPhotosFinalizePhoto(input: { id, title?, keywords? })`. It checks that the uploaded original exists and decodes as a supported image, generates the thumb, grid and display WebP derivatives, stores them public-read, and promotes the photo to `ready`. It returns `{ photo, photoEdge }`. If anything fails after the photo is found pending, the photo is marked `failed` with a reason rather than left half-promoted.
- New admin-only Relay mutation `dmbkPhotosDeletePhoto(input: { id })`. It removes the photo record, its keyword counts, and exactly the storage keys recorded on it (never by prefix: the Space is shared with lora-trainer). It returns `{ deletedPhotoId }`. If the record is deleted but its files are not, it returns an error that says so rather than reporting a clean delete.
- Ported from dmbk: the Spaces client (presign, head, get, put, delete), the key layout (`photos/{id}/original.{ext}`, `display.webp`, `grid.webp`, `thumb.webp`), the content-type and size limits, and the sharp image inspection and resizing. Keyword normalization, `isCounted`, label registration at reserve time, and `PHOTO_SCHEMA_VERSION` (3) stay identical to dmbk, because both apps still write.
- New required configuration: `DO_SPACES_ENDPOINT`, `DO_SPACES_REGION`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_BUCKET`. New runtime dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `sharp`.
- Not in scope:
  - The admin photo reads (`adminList`, `adminById`). They're already covered by `dmbkPhotos(visibility, states)` and `node`.
  - Removing dmbk's tRPC procedures and moving dmbk's admin UI over (Phase 4).
  - dmbk's maintenance scripts (`recount-keywords`, `cleanup-pending-photos`, `backfill-grid-derivative`), which stay in dmbk.

## Capabilities

### New Capabilities
- `photo-upload`: reserving an upload, uploading straight to storage, and finalizing into a `ready` photo with derivatives. Covers the size, type and decoding rules, how failures are recorded, and admin-only access.
- `photo-delete`: permanently deleting a photo, covering its record, keyword counts and stored files, and how a delete that only partly succeeds is reported.

### Modified Capabilities
<!-- None. The new fields follow graphql-schema-naming's existing prefix rule without changing it. -->

## Impact

- Code:
  - New Spaces and image modules under `src/lib/`.
  - New write functions in `src/lib/photos/repository.ts`.
  - Three mutations in `src/schema/mutations.ts`.
  - New domain errors registered in `src/errors.ts`.
  - Spaces config in `src/env.ts`.
- Dependencies: `sharp` ships a native binary. It must install from prebuilt binaries on the droplet (Linux x64) under `npm ci --omit=dev`.
- Infrastructure:
  - The droplet's `.env` needs the five Spaces variables before this deploys, or the server exits at startup.
  - The Space's CORS rules must allow `PUT` from every origin that uploads.
  - Finalize holds a full original (up to 50 MB) in memory while it resizes, so memory use on the single PM2 process goes up.
- Clients: these mutations need an admin session. Under the new Google-accounts auth, dmbk's admin can only call them once its sign-in migration lands (the `google-accounts` change, tasks 2.x).
- Tests and docs:
  - `scripts/test-mutations.ts` gains reserve, PUT, finalize and delete checks against live storage, cleaning up after itself.
  - `README.md`, `CLAUDE.md`/`AGENTS.md` and the roadmap's Phase 2 checklist are updated.
