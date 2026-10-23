# Tasks

## 1. Preflight

- [x] 1.1 Confirm the `lora-trainer` indexes listed in design "Context" exist on Atlas (`db.lora_trainings.getIndexes()`, `db.generated_images.getIndexes()`). Verify that the `requestId_1` index is `unique: true`, and record any difference in this task before continuing.
  - Checked in mongosh on 2026-10-23. Every index listed is present, and `requestId_1` is `unique: true`. Two leftovers aren't in lora-trainer's code: `lora_trainings.status_1` (redundant with `status_1_hidden_1`) and `generated_images.walletAddress_1` (pre-accounts). Both are noted in `CLAUDE.md` and left in place.
- [ ] 1.2 Confirm production `DO_SPACES_CDN_URL` on the droplet equals lora-trainer's `DO_SPACES_CDN_URL` in Vercel, ignoring a trailing slash. Verify by comparing the two values (don't paste them into the repo).
  - Pending: needs the droplet's `.env` and Vercel's value, which I didn't read.

## 2. Repository

- [x] 2.1 Add `lib/lora/ids.ts` (`newLoraId`, `isLoraId`) and `lib/lora/urls.ts` (`assertHttpsUrl`, `assertMirrorUrl` against `${env.cdnUrl}/lora-trainer/`, throwing `InvalidInputError`). Verify with `npm run typecheck`, and with a scratch `tsx` call that refuses `http://…`, another host, and `…/lora-trainer/../photos/x`.
- [x] 2.2 Add `createTraining(viewer, input)`: validate ranges and URLs, insert with `newLoraId()`, status `pending`, `hidden: false`, `imageUrlsSpaces: []`, nulls as lora-trainer writes them, and map `E11000` on `requestId` to `InvalidInputError`. Verify with `npm run typecheck`. Behavior is checked in 4.1.
- [x] 2.3 Add `setTrainingAssets(viewer, id, { trainingZipUrl?, imageUrlsSpaces? })` and `completeTraining(viewer, id, { loraWeightsUrl, imageUrlsSpaces? })` with the NOT_FOUND/FORBIDDEN rule from `setTrainingHidden`. Completion uses the conditional update from design §5. Verify with `npm run typecheck`.
- [x] 2.4 Add `findOwnTrainingByRequestId(viewer, requestId)`. Verify with `npm run typecheck`.
- [x] 2.5 Add `recordImages(viewer, loraTrainingId, images)`: 1–8 images, per-image validation, a visibility and completed check on the LoRA, then `insertMany` in `loraDb().transaction`, with an `E11000` there mapped to `InvalidInputError`. Verify with `npm run typecheck`.
- [x] 2.6 Add `slideshowImages(count)` per design §8. Verify against live data from a scratch `tsx` call that it returns ≤ `count` distinct URLs and that none of them belongs to a hidden image or training (cross-check with a `find`).
  - Checked through 4.1's run on live data (2026-10-23): at most 20 distinct URLs per call, and over 5 calls of 20 none of the hidden-LoRA fixture URLs appeared (its source images, and a visible image on it). Not a full cross-check against every hidden record.

## 3. Schema

- [x] 3.1 In `schema/mutations.ts`, add `loraTrainerCreateTraining`, `loraTrainerSetTrainingAssets`, `loraTrainerCompleteTraining` (payload `loraTraining`) and `loraTrainerRecordImages` (input `loraTrainingId` global ID + `images`, payload `generatedImages` + `loraTraining`), all `signedIn`. Verify that `npm run typecheck` passes and GraphiQL shows the four fields with their inputs.
  - Checked by printing the built schema offline instead of opening GraphiQL. The four fields, their inputs and the payloads are as specified.
- [x] 3.2 In `schema/types/viewer.ts`, add `loraTrainerTrainingByRequestId(requestId: String!): LoraTraining`. In `schema/types/lora.ts`, add the `LoraTrainerSlideshowImage { url }` type. In `schema/queries.ts`, add `loraTrainerSlideshowImages(count: Int = 10)` with a 1–20 range check. Verify in GraphiQL that anonymous `loraTrainerSlideshowImages(count: 5)` returns 5 or fewer URLs and `count: 0` returns `BAD_USER_INPUT`.
  - `count` 0, 21 and 1.5 → `BAD_USER_INPUT` (checked offline). An anonymous keyed read and `count: 0` were checked against a running local server in 4.1's run.
- [x] 3.3 Check the new field names against `openspec/specs/graphql-schema-naming/`. Verify each root and `Viewer` field has the `loraTrainer` prefix and that no input or payload type name is hand-set.
  - `LoraTrainerRecordImagesImageInput` (the nested batch item) is the one hand-named type, which is unavoidable for a nested input. It's named after its field.

## 4. Mutation tests

- [x] 4.1 Add a LoRA writes suite to `scripts/test-mutations.ts` on fixtures it deletes afterwards. It should cover: create (owner, signed out, duplicate request id, out-of-range input, non-https URL); assets and complete (owner, non-owner on pending → NOT_FOUND, non-owner on public → FORBIDDEN, off-prefix mirror refused, repeat completion keeps the first weights URL); lookup by request id (owner, other account → null); record images (happy batch of 4 in order, pending LoRA → BAD_USER_INPUT, someone else's hidden LoRA → NOT_FOUND, an id reused across or within batches → nothing written); and the slideshow never returning a hidden fixture's URL. Verify that `npm run test:mutations` passes against a local server and that `-- --cleanup` afterwards finds nothing left over.
  - `npm run test:mutations` on 2026-10-23: 110 passed, 0 failed, 26 of them in `LoRA writes`. `-- --cleanup` afterwards deleted 0 of everything.
- [x] 4.2 Verify that the playground refuses the new mutations: with the server started with `API_KEYS_ENFORCED=true`, a keyless `loraTrainerCreateTraining` returns `FORBIDDEN` (the existing playground suite, extended by one case).
  - Ran with `API_KEYS_ENFORCED=true` on 2026-10-23: `keyless loraTrainerCreateTraining → FORBIDDEN`, with 124 passed and 0 failed overall.

## 5. Docs

- [x] 5.1 Update `CLAUDE.md`: the `lora-trainer` row becomes API-owned, with its index list under the "create or change by hand" rule, the transaction note (design §3), and the LoRA visibility bullet mentioning the write rules. Update the `models/lora.ts` header comment so it no longer calls lora-trainer the source of truth. Verify that neither still says lora-trainer's `db.ts` is the source of truth.
- [x] 5.2 Update the roadmap's Phase 3: FAL and mirroring stay in lora-trainer, completion stays client-driven (no webhook), no long-running mutation, list the fields shipped. Point Phase 4 step 5 at lora-trainer's `adopt-relay-graphql-client`. Verify that Phase 3's two "Decide…" bullets are resolved in the text.

## 6. Ship

- [ ] 6.1 Merge to `main` and confirm the deploy job passes. Verify with production introspection: the four mutations, `Viewer.loraTrainerTrainingByRequestId` and `loraTrainerSlideshowImages` are present.
- [ ] 6.2 After lora-trainer's `adopt-relay-graphql-client` has run for a week with no rollback, remove `lora-trainer-app2`'s Atlas access and rewrite `CLAUDE.md`'s "Both apps still read/write…" paragraph for lora-trainer. Verify that lora-trainer production still works and that the Atlas user list no longer grants it `lora-trainer`.
