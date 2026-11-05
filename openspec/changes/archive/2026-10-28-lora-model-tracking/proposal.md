# Proposal

## Why

lora-trainer is adding a base-model picker (lora-trainer change `lora-base-model-picker`). With it, a LoRA can be trained on FLUX.1 dev, Z-Image Turbo, FLUX.2 [klein] 9B, Qwen Image 2512 or Krea 2, and images generated on the matching fal.ai endpoint. Today neither record says which model made it. Every LoRA so far was trained with `fal-ai/flux-lora-fast-training` and every image generated with `fal-ai/flux-lora`, but that is known only from lora-trainer's code history. Once more than one model is in use, a LoRA's weights only work with its own family's generation endpoint, so the app needs the model on the record to generate at all. We also want the model recorded on each record so we can see which models are used, both for the existing records and for new ones.

## What Changes

- **New field on trainings:** `trainerModel`, the fal.ai endpoint id the LoRA was trained with. `loraTrainerCreateTraining` takes it as an optional input. Exposed as `LoraTraining.trainerModel: String!`.
- **New field on generated images:** `generatorModel`, the fal.ai endpoint id the image was generated with. `loraTrainerRecordImages` takes it once per batch, as an optional input. Exposed as `GeneratedImage.generatorModel: String!`.
- **Defaults for older clients and records:** an omitted input is recorded as the model lora-trainer used before the picker (`fal-ai/flux-lora-fast-training` / `fal-ai/flux-lora`). A record missing the field reads back as the same value. The lora-trainer currently deployed keeps working and keeps recording correctly.
- **Format check, not an allowlist:** the value must look like a fal.ai endpoint id (lowercase path segments, at most 100 characters). Which models are offered is lora-trainer's decision, so adding a model there needs no API deploy.
- **Backfill for existing records:** `npm run backfill:models` writes the legacy values into every training and image that lacks them. It is report-only by default (`-- --apply` to write) and safe to re-run.
- **Not included:** filtering listings by model, a per-model `steps` range (the 100–2000 rule stays), and the `failed` status.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `lora-trainer-records`: "Create a pending training" and "Record generated images" take and store the model. A new requirement covers how the model reads back, including the legacy default and the backfill.

## Impact

- **Code:** `models/lora.ts` (two optional fields), `lib/lora/repository.ts` (validate and store them), new `lib/lora/models.ts` (format check and legacy defaults), `schema/mutations.ts` (two inputs), `schema/types/lora.ts` (two fields).
- **Scripts:** new `scripts/backfill-models.ts` and its `package.json` script. `scripts/test-mutations.ts` covers the new inputs.
- **Data:** a one-time `$set` on `lora_trainings` and `generated_images` documents that lack the fields. No index changes.
- **Clients:** the schema change only adds fields, so the deployed lora-trainer is unaffected. lora-trainer's `lora-base-model-picker` depends on this shipping first. dmbk-photo and dmbk don't read these types.
- **Docs:** `CLAUDE.md` (the LoRA bullet and the scripts list).
