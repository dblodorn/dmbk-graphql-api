# Design

## Context

- `lora_trainings` and `generated_images` belong to this API, and lora-trainer writes them only through the `loraTrainer…` mutations (`lib/lora/repository.ts`). Neither document has a model field (`models/lora.ts`).
- In lora-trainer's history (`git log -p` back to `529acff`, when the repo was extracted from dmbk-world), only two fal.ai endpoints were ever called: `fal-ai/flux-lora-fast-training` for training and `fal-ai/flux-lora` for generation. Before that extraction, the code lived in dmbk-world, and that history hasn't been checked yet (task 1.1).
- The deployed lora-trainer sends neither field and must keep working until it moves to the picker.

## Goals / Non-Goals

**Goals:**
- Record the exact fal.ai endpoint on every new training and image, and make the existing records explicit.
- Leave the choice of models to lora-trainer, with no API deploy needed when it adds one.

**Non-Goals:**
- A model catalog, labels or pricing in the API. These belong to lora-trainer.
- Filtering or grouping by model in listings. A later change can add a `trainerModel` argument if it's wanted.
- Per-model `steps` limits. Every model lora-trainer plans to offer accepts 100–2000.

## Decisions

### 1. Store the fal.ai endpoint id, not a model "family" key
`trainerModel` and `generatorModel` hold endpoint ids such as `fal-ai/z-image-turbo-trainer-v2`. The endpoint is what was actually called and billed, so it answers "which models are used" exactly, and the value means the same thing no matter which version of lora-trainer wrote it. lora-trainer maps an endpoint to its family (which generator a LoRA works with, and the label to show).
- *Alternative:* a family enum (`FLUX_1_DEV`, `Z_IMAGE_TURBO`, …). It's friendlier in GraphQL, but every new model would need an API deploy and a schema pull, and the enum would lose detail when fal ships a v2 trainer for the same family.

### 2. A format check, not an allowlist
`lib/lora/models.ts` exports `assertModelId(value, field)`. It accepts 1–100 characters matching `^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)+$` and otherwise throws `InvalidInputError`. That keeps out junk such as URLs, whitespace and very long strings, without the API deciding which models are allowed. The field is informational and selects nothing on the API side, so a wrong but well-formed value only mislabels the caller's own record.

### 3. Defaults applied on write and on read
`LEGACY_TRAINER_MODEL = 'fal-ai/flux-lora-fast-training'` and `LEGACY_GENERATOR_MODEL = 'fal-ai/flux-lora'` live in `lib/lora/models.ts`.
- **On write:** an omitted input is stored as the legacy value. A client that sends nothing is by definition the pre-picker lora-trainer, which calls exactly those endpoints.
- **On read:** the resolvers return `doc.trainerModel ?? LEGACY_TRAINER_MODEL`, and the same pattern for images. The GraphQL fields are therefore non-null from the first deploy, before the backfill runs, and stay correct if a record is ever written outside the API.
- The models keep both fields optional (`trainerModel?: string`), like `ownerId`, because older documents lack them.

### 4. One generator model per batch
`loraTrainerRecordImages` takes `generatorModel` on its input, not on each image, because one fal.ai call produces the whole batch. The repository copies it onto each document. A per-image field would let a single batch claim to come from two models.

### 5. The backfill script
`scripts/backfill-models.ts` (`npm run backfill:models`) follows `backfill-owner-id.ts`. By default it reports how many trainings and images lack the field. With `-- --apply` it runs `updateMany({ trainerModel: { $exists: false } }, { $set: { trainerModel: LEGACY_TRAINER_MODEL } })` and the same for images, then reports the counts again. It never overwrites an existing value, so it's safe to re-run. It writes the values explicitly, even though reads already default, so the data itself records the history (for Atlas queries, exports, or a later `trainerModel` filter backed by an index).

## Risks / Trade-offs

- **[Pre-extraction records may have used another endpoint]** → Task 1.1 checks the dmbk-world history for other fal endpoints before `--apply`. If it finds any, the backfill is narrowed by `createdAt` and the open record set is noted in tasks.
- **[A client can write a model it didn't use]** → Only on its own records, and the API doesn't use the value for anything. This is the same trust it already gives `seed` or `loraScaleName`.
- **[A future rename by fal]** → The stored ids stay what was called at the time, which is correct history. lora-trainer's catalog can map old ids to the same family.

## Migration Plan

1. Merge and deploy (additive: new optional inputs, new non-null fields with defaults).
2. Run `npm run backfill:models` against production to see the counts, then `-- --apply`. Re-run without `--apply` to confirm that zero remain.
3. lora-trainer pulls the schema and ships `lora-base-model-picker`.
4. Rollback: revert the commit. The stored fields are harmless to older code (`strict` models ignore them on read, and nothing removes them).
