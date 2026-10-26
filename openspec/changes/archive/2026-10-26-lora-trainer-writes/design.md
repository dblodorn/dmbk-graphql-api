# Design

## Context

- `lib/lora/repository.ts` already holds the LoRA visibility rules (`isPublicTraining`, `isPublicImage`, `isOwner`) and the hide writes, including the rule "a non-owner can't tell a hidden record from a missing one" (NOT_FOUND vs FORBIDDEN). `InvalidInputError`, `LoraNotFoundError` and `ForbiddenError` are already mapped in `errors.ts`.
- lora-trainer writes these documents today (`src/server/api/db.ts` and `features/{fal,lora,generate}.ts` there). Its ids are `crypto.randomBytes(16).toString('hex')` and its dates ISO strings. Its mirror URLs are `${DO_SPACES_CDN_URL}/${key}`, with keys under `lora-trainer/` (`training-zips/{id}/`, `training-images/{id}/`, `loras/{id}/`, `images/{loraId}/{imageId}.{ext}`). Batches are 4 images, and prompts are capped at 500 characters there.
- lora-trainer's `ensureIndexes` created: `lora_trainings` `{requestId:1}` unique, `{status:1, hidden:1}`, `{createdAt:-1}`, `{ownerId:1, hidden:1}`; `generated_images` `{loraTrainingId:1}`, `{ownerId:1, hidden:1}`, `{createdAt:-1}`. `autoIndex` is off here.
- The client side of this is lora-trainer's `adopt-relay-graphql-client` (its design §5). Its FAL procedures call these mutations server-side with the viewer's session and the app's key.

## Goals / Non-Goals

**Goals:**
- Write documents identical in shape to lora-trainer's, so either app version can run against the data during rollout and rollback.
- Keep every visibility and ownership decision in the repository, next to the read rules.

**Non-Goals:**
- Calling fal.ai, uploading to Spaces, or checking that a URL actually resolves.
- Restricting these writes to the `lora-trainer` client key (see Decision 6).
- A `failed` transition or deleting trainings.

## Decisions

### 1. The API assigns training ids; the client assigns image ids
lora-trainer creates the training first and then builds its mirror keys from the returned id, so the API can own training ids. For images it's the other way round: the app uploads `images/{loraId}/{imageId}.{ext}` before recording, so the key must exist before the record does. Rather than add a reserve round-trip, the client sends the id. The API checks it's 32 lowercase hex and unused.
- *Alternative:* a `loraTrainerReserveImageIds(count)` mutation. Rejected because it's an extra call per batch on a path that already waits on fal.ai, and it only protects against a client colliding with itself.
- *Alternative:* change the Spaces key layout to something not tied to the id. Rejected because the layout has to stay identical while the two writers overlap.

### 2. One shared id helper, the same format as lora-trainer
`lib/lora/ids.ts` exports `newLoraId()` (`randomBytes(16).toString('hex')`) and `isLoraId()`. The format matches so that old and new records are indistinguishable, and so that `isLoraId` can validate client-supplied image ids.

### 3. Batch image writes run in a transaction
`recordImages` validates the whole batch first (ids, URLs, sizes, the LoRA's visibility and status), then runs `insertMany` inside `loraDb().transaction(...)`. A duplicate `_id` that races past the pre-check fails the transaction, which is reported as `BAD_USER_INPUT` with nothing written. Atlas is a replica set, so transactions are available. This is the first one in this codebase, so `CLAUDE.md` gets a line on it.
- *Alternative:* `insertMany({ ordered: true })` and deleting the partial batch on error. Rejected because a crash between the insert and the cleanup leaves half a batch.

### 4. Duplicate request ids are caught by the unique index
`createTraining` doesn't pre-check. It inserts and maps Mongo's `E11000` on `requestId_1` to `InvalidInputError`, so the existing unique index is the single authority, with no read-then-write race.

### 5. Idempotent completion through a conditional update
`completeTraining` loads the doc (for the visibility and ownership refusals) and then updates with `{ _id, status: { $ne: 'completed' } }`. If the update matches nothing, the training was already completed, possibly by a concurrent call, and the current doc is returned unchanged. That satisfies "repeat completion changes nothing" without a lock.

### 6. Any signed-in account may write, same as the hide mutations
The new mutations use `authScopes: { signedIn: true }` and ownership checks, exactly like `loraTrainerSetTrainingHidden`. Only lora-trainer has a reason to call them, but nothing is gained by tying them to its key name. `context.client` is "for logs" by design, the `test-mutations` script runs under its own key, and the session plus owner rules already decide whose records change. The URL rules (Decision 7) close the actual abuse path: pointing public records at arbitrary hosts.

### 7. URL rules in one module
`lib/lora/urls.ts` has `assertHttpsUrl(url)` and `assertMirrorUrl(url)`. The second requires the prefix `${env.cdnUrl}/lora-trainer/`, compared after `new URL()` normalization, which rejects `..` paths. The repository calls both before any write. Source and fal.ai URLs only need `https`, since lora-trainer already SSRF-guards what it downloads and this API never fetches them.

### 8. Slideshow by two `$sample`s, filtered in the pipeline
`slideshowImages(count)`:
- `generated_images`: `$match hidden ≠ true`, `$sample` of `count * 2`, `$lookup` its training, keep those whose training is completed and not hidden, project `cdnUrl ?? imageUrl`.
- `lora_trainings`: `$match` completed and not hidden, `$sample` of 5, flatten `imageUrlsSpaces` when non-empty, else `imageUrls`.

The results are combined, de-duplicated and shuffled in memory, then cut to `count`. Oversampling by 2× makes up for images dropped by the `$lookup` filter. The return type is `[LoraTrainerSlideshowImage!]!` with a single `url` field, so dimensions or a link back to the image can be added later without breaking the schema.
- *Alternative:* return `[String!]!`. Rejected because it can't grow.
- *Alternative:* return `GeneratedImage` nodes. Rejected because training source images aren't nodes.

### 9. The payloads return repository results
As with the existing mutations, the payload carries the document the repository wrote, not a loader read, because the per-request loader may hold the pre-mutation copy. `loraTrainerRecordImages` returns `generatedImages: [GeneratedImage!]!` plus `loraTraining`, so Relay can update both.

### 10. Indexes are documented, not created
The listed indexes exist on Atlas. `CLAUDE.md` moves `lora-trainer` to API-owned and lists them under the existing "create or change by hand" rule, as it does for `dmbk-photos`. `Viewer.loraTrainerTrainingByRequestId` uses the `requestId` unique index. The slideshow's `$match` is served by `{status:1, hidden:1}`.

## Risks / Trade-offs

- **Clients choose image ids, so a client could pick ids that are meant to clash.** → The only effect is that its own batch is refused. Ids are checked for format and uniqueness, and an image's owner is always the caller.
- **The transaction adds latency and a new failure mode on the generation path.** → Batches are at most 8 small documents. A transient transaction error comes back as a normal error, and lora-trainer retries once (its design, Risks).
- **`$sample` on `generated_images` scans when the sample size is over 5% of the collection.** → At about 330 visible images, sampling 20 is cheap either way. Revisit if the collection grows by orders of magnitude.
- **The URL prefix depends on `DO_SPACES_CDN_URL` matching lora-trainer's `DO_SPACES_CDN_URL`.** → Both apps already share the Space. Task 1.2 checks the two values match in production before lora-trainer switches over.
- **Owner-only `trainingZipUrl` could be set by its owner to any Spaces URL under `lora-trainer/`, including another training's zip.** → Only the owner can read that field, so the only person affected is the owner.

## Migration Plan

1. Merge to `main`. This deploys to the droplet, and the change is additive, so the current lora-trainer, which still writes Mongo directly, is unaffected.
2. Run `npm run test:mutations` against a local server on live data before merging. It covers the new suite and restores everything.
3. lora-trainer pulls the schema and ships `adopt-relay-graphql-client`. From then on this API is the only writer.
4. Rollback: revert the merge. lora-trainer's previous build still writes directly, so nothing depends on these fields until step 3.
5. After lora-trainer's soak (a week, its task 8.2): drop `lora-trainer-app2`'s Atlas access, and update `CLAUDE.md`'s "Both apps still read/write…" paragraph and the roadmap's Phase 4 step 5.

## Open Questions

- Whether `loraWeightsUrl` should become owner-only (the roadmap's open question). These writes don't change the answer, and it can be decided separately.
