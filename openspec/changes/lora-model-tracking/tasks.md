# Tasks

## 1. Preflight

- [x] 1.1 Check dmbk-world's history (the repo lora-trainer was extracted from at `529acff`) for any fal.ai training or generation endpoint other than `fal-ai/flux-lora-fast-training` / `fal-ai/flux-lora` (`git log -p --all | grep -oE '"fal-ai/[a-z0-9./-]+"' | sort | uniq -c`). Verify by recording the result here. If another endpoint turns up, note its date range and narrow task 4.2's backfill to match.
  - Checked 2026-10-28 on a bare clone of `dblodorn/dmbk-world`, all branches, back to its first commit (2025-07-15). It used only `fal-ai/flux-lora-fast-training` (training, since 2025-07-16) and `fal-ai/flux-lora` (generation, since 2026-02-11). lora-trainer's own history matches. The backfill covers every record without narrowing.

## 2. Repository

- [x] 2.1 Add `lib/lora/models.ts` with `LEGACY_TRAINER_MODEL`, `LEGACY_GENERATOR_MODEL` and `assertModelId(value, field)` (design §2). Verify with `npm run typecheck`, and with a scratch `tsx` call that accepts `fal-ai/flux-lora`, `fal-ai/z-image/turbo/lora` and `fal-ai/flux-2/klein/9b/lora`, and refuses `flux-lora`, `https://fal.ai/x`, `fal-ai/Flux`, `fal-ai/ x` and a 101-character id.
- [x] 2.2 Add optional `trainerModel` to `LoraTrainingDoc` and `generatorModel` to `GeneratedImageDoc` and their schemas in `models/lora.ts`. Verify with `npm run typecheck`.
- [x] 2.3 In `lib/lora/repository.ts`, `createTraining` takes optional `trainerModel` (checked, defaulting to the legacy value), and `recordImages` takes an optional batch-level `generatorModel` (checked before any write, copied onto every doc). Verify with `npm run typecheck`. Behavior is checked in 5.1.

## 3. Schema

- [x] 3.1 In `schema/mutations.ts`, add `trainerModel: String` to `LoraTrainerCreateTrainingInput` and `generatorModel: String` to `LoraTrainerRecordImagesInput`, each with a description naming the default. Verify that `npm run typecheck` passes and the printed schema shows both inputs.
  - Checked by printing the built schema offline: both inputs present, optional, with the defaults in their descriptions.
- [x] 3.2 In `schema/types/lora.ts`, add `LoraTraining.trainerModel: String!` and `GeneratedImage.generatorModel: String!`, resolving a missing value to the legacy default (design §3). Verify against a local server that an existing production record returns `fal-ai/flux-lora-fast-training` / `fal-ai/flux-lora` before the backfill.
  - Checked 2026-10-28 against a local server on production data, before any backfill: the two newest public trainings read `fal-ai/flux-lora-fast-training` and their images `fal-ai/flux-lora`.

## 4. Backfill

- [x] 4.1 Add `scripts/backfill-models.ts` and `"backfill:models"` in `package.json`, modeled on `backfill-owner-id.ts`: report-only by default, `--apply` to `$set` the legacy values where the field is missing, with counts before and after. Verify with `npm run typecheck` and a report-only run that prints the counts and writes nothing.
  - Report-only run on 2026-10-28: 18 trainings and 368 images without a model, nothing written. Matches `$exists: false`, `null` and `''`, as `backfill-owner-id.ts` does.
- [ ] 4.2 After deploy, run `npm run backfill:models -- --apply` against production, then once more without `--apply`. Verify that the second run reports 0 trainings and 0 images missing a model, and record the counts here.

## 5. Mutation tests

- [x] 5.1 Extend the LoRA writes suite in `scripts/test-mutations.ts`: create with and without `trainerModel` (reads back as given / legacy), create with a malformed model → `BAD_USER_INPUT` and nothing written; record a batch with and without `generatorModel` (every image reads back as given / legacy), a malformed model → `BAD_USER_INPUT` and no image written; an anonymous keyed read of a public fixture returns both fields. Verify that `npm run test:mutations` passes against a local server and `-- --cleanup` finds nothing left over.
  - `npm run test:mutations` on 2026-10-28: 120 passed, 0 failed, 11 of them new model cases in `LoRA writes` (plus an unlisted-but-well-formed id, and a pre-model fixture reading as legacy). `-- --cleanup` afterwards deleted 0 of everything.

## 6. Docs

- [x] 6.1 Update `CLAUDE.md`: the LoRA visibility bullet mentions `trainerModel` / `generatorModel` (fal endpoint ids, format-checked, legacy default on read and write), and the commands list gains `npm run backfill:models`. Verify that both are present.
