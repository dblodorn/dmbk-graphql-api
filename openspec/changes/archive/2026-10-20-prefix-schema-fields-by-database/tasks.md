# Tasks

## 1. Rename schema fields

- [x] 1.1 In `src/schema/queries.ts`, rename `photos` → `dmbkPhotos`, `keywords` → `dmbkPhotosKeywords`, `soundPlaylists` → `dmbkPhotosSoundPlaylists`, `loraTrainings` → `loraTrainerTrainings`, and leave `_health`/`viewer` untouched. Verify with `npm run typecheck`.
- [x] 1.2 In `src/schema/mutations.ts`, rename `updatePhoto` → `dmbkPhotosUpdatePhoto`, `setPhotoHidden` → `dmbkPhotosSetPhotoHidden`, `setLoraTrainingHidden` → `loraTrainerSetTrainingHidden`, `setGeneratedImageHidden` → `loraTrainerSetImageHidden`. Keep the payload keys (`photo`, `loraTraining`, `generatedImage`) and leave `siweNonce`/`signInWithEthereum` alone. Verify with `npm run typecheck`.
- [x] 1.3 In `src/schema/types/viewer.ts`, rename `loraTrainings` → `loraTrainerTrainings` and `generatedImages` → `loraTrainerImages`. Verify with `npm run typecheck`.
- [x] 1.4 Print the SDL (as during planning: `MONGODB_URI=mongodb://x DO_SPACES_CDN_URL=https://x npx tsx -e …printSchema(builder.toSchema())`). Confirm that the new root, Viewer, input, payload and connection names are present, that none of the old names remain, and that `Photo`/`LoraTraining`/`GeneratedImage`/`LoraTraining.images` are unchanged.

## 2. Update the mutation test script

- [x] 2.1 In `scripts/test-mutations.ts`, switch every GraphQL string and every result accessor to the new names: the `keywords`/`photos` reads, the `UPDATE_PHOTO`/`SET_PHOTO_HIDDEN`/`SET_TRAINING_HIDDEN`/`SET_IMAGE_HIDDEN` documents and their `…Input!` types, the `.updatePhoto`/`.setPhotoHidden`/… payload accessors, and the LoRA section's queries around lines 290–310. Then grep the file for each old name and get no matches. Verify with `npm run typecheck`.
- [x] 2.2 Start a local server (`npm run dev`) and run `npm run test:mutations`. Every check passes and the data is restored.

## 3. Docs

- [x] 3.1 `README.md`: update the Queries and Mutations tables and the `viewer` row to the new names, and add one sentence stating the prefix convention. Verify that a grep of the README finds no old field names.
- [x] 3.2 `CLAUDE.md` and `AGENTS.md`: add the naming rule (database prefix in camelCase, drop redundant words, cross-cutting fields exempt) under Architecture → Relay, so new fields follow it. Verify that it reads correctly in both files.
- [x] 3.3 `docs/plans/2026-10-08-migration-roadmap.md`: rename the Phase 1 field list, the Phase 2 planned mutations (`dmbkPhotosReservePhotoUpload`, `dmbkPhotosFinalizePhoto`, `dmbkPhotosDeletePhoto`), the Phase 3 mappings (`viewer.loraTrainerTrainings`, `viewer.loraTrainerImages`, and the remaining-quota/slideshow fields under the `loraTrainer` prefix), and the Phase 1 test notes. Verify that a grep for the old names finds only historical references, if any.

## 4. Final check

- [x] 4.1 `npm run typecheck` passes. A repo-wide grep (excluding `node_modules` and `openspec/`) for `\b(updatePhoto|setPhotoHidden|setLoraTrainingHidden|setGeneratedImageHidden|soundPlaylists)\b`, and for `photos(`/`loraTrainings(`/`generatedImages(` used as GraphQL fields, finds no leftovers.
