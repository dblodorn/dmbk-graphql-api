# Proposal

## Why

lora-trainer is moving every Mongo read and write behind this API and reading through Relay (lora-trainer change `adopt-relay-graphql-client`). Its reads and hide/unhide are already covered by Phase 1: `loraTrainerTrainings`, `LoraTraining.images`, `node`, `viewer.loraTrainerTrainings` / `loraTrainerImages` with `visibility`, and the two `loraTrainerSet*Hidden` mutations. What's missing is the writes its FAL work produces (a pending training, its Spaces mirrors, completion, generated images) and the slideshow. Until those exist, lora-trainer has to keep its own Mongo connection and its own copy of the ownership rules.

This settles the roadmap's Phase 3 differently from its draft. The FAL.ai calls and the Spaces mirroring **stay in lora-trainer**, and this API only records what they produced. So there's no `FAL_KEY` here, no long-running generation mutation, no Caddy timeout change, and no fal.ai webhook. Completion stays client-driven, as it is today.

## What Changes

- **New:** `loraTrainerCreateTraining`. A signed-in account records a pending training it has just queued on fal.ai: request id, trigger word, steps, source image URLs and Are.na channel. It is owned by the caller, and the API assigns the id.
- **New:** `loraTrainerSetTrainingAssets`. The owner attaches the training zip and the Spaces mirrors of the source images.
- **New:** `loraTrainerCompleteTraining`. The owner marks a pending training completed with its weights URL (and backfilled mirrors). Completing an already-completed training is a no-op.
- **New:** `loraTrainerRecordImages`. A signed-in account records a batch of images it generated on one completed LoRA it can see. The caller supplies each image's id, because the app builds its Spaces key from that id before recording.
- **New:** `Viewer.loraTrainerTrainingByRequestId(requestId)`. The caller's own training for a fal.ai request id, or null. The app's completion step starts from the request id.
- **New:** `loraTrainerSlideshowImages(count)`. A random mix of visible generated images and training source images from visible, completed trainings, as the roadmap asks: hidden images and hidden trainings are left out, unlike lora-trainer's original.
- **URL checks on every write:** URLs must be `https`. Fields that claim to be Spaces mirrors (`imageUrlsSpaces`, `trainingZipUrl`, `cdnUrl`) must be under `DO_SPACES_CDN_URL/lora-trainer/`, so a client can't put arbitrary hosts behind the CDN-preferring fields.
- **Indexes:** the `lora-trainer` indexes become this API's to keep, as `dmbk-photos`' did. lora-trainer's `ensureIndexes` stops running once it drops Mongo. The indexes already exist and are documented here, not created.
- **Not included:** FAL calls, Spaces uploads, generation quotas (`viewer.loraTrainerRemainingGenerations` waits for open sign-up), a `failed` status transition, and anything in dmbk.

## Capabilities

### New Capabilities

- `lora-trainer-records`: how LoRA trainings and generated images are written through this API (create, attach assets, complete, record images), who may write them, the URL rules on those writes, the owner lookup by request id, and the public slideshow.

### Modified Capabilities

(none. `graphql-schema-naming` already covers the `loraTrainer…` prefix, and the new fields follow it. `api-access` is unchanged: these are mutations, so the playground already refuses them.)

## Impact

- **Code:** `lib/lora/repository.ts` gains the writes, the request-id lookup and the slideshow sample. New `lib/lora/urls.ts` for the URL rules. `schema/mutations.ts` gets four `relayMutationField`s, `schema/queries.ts` the slideshow, `schema/types/viewer.ts` the lookup, and `schema/types/lora.ts` a small `LoraTrainerSlideshowImage` type. `errors.ts` maps any new domain error.
- **Models:** `models/lora.ts` stops saying lora-trainer is the source of truth, because this API now writes the same shapes. Its fields are unchanged.
- **Scripts:** `scripts/test-mutations.ts` covers the new mutations (owner, non-owner, signed-out, bad URLs, a duplicate request id, idempotent completion) on fixtures it cleans up.
- **Docs:** `CLAUDE.md` (the `lora-trainer` row moves to API-owned, plus its index list) and the roadmap's Phase 3 (the decisions above) and Phase 4 step 5.
- **Clients:** lora-trainer's `adopt-relay-graphql-client` depends on this shipping first. It's additive, so the current lora-trainer is unaffected.
