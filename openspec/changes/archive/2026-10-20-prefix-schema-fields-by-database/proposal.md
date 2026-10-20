# Proposal

## Why

The API serves two unrelated databases, `dmbk-photos` and `lora-trainer`, but the root fields don't say which one they touch. `photos` and `keywords` read as generic names, and `viewer.generatedImages` doesn't show that it belongs to lora-trainer. Phases 2 and 3 will add more fields to both sides, and Phase 4 moves the two apps' clients over one capability at a time. A prefix lets each client, and anyone reading the schema, see which fields belong to which app. Now is the cheapest time to rename: no client uses this API yet (the Phase 4 migration hasn't started), so no deprecation period is needed.

## What Changes

- **BREAKING** Every root Query and Mutation field that reads or writes a database gets that database's name as a camelCase prefix (`dmbkPhotos…`, `loraTrainer…`). A word the prefix already says is dropped from the rest of the name:
  - Queries: `photos` → `dmbkPhotos`, `keywords` → `dmbkPhotosKeywords`, `soundPlaylists` → `dmbkPhotosSoundPlaylists`, `loraTrainings` → `loraTrainerTrainings`.
  - Mutations: `updatePhoto` → `dmbkPhotosUpdatePhoto`, `setPhotoHidden` → `dmbkPhotosSetPhotoHidden`, `setLoraTrainingHidden` → `loraTrainerSetTrainingHidden`, `setGeneratedImageHidden` → `loraTrainerSetImageHidden`.
- **BREAKING** The `Viewer` fields that read a database get the same prefix: `viewer.loraTrainings` → `viewer.loraTrainerTrainings`, `viewer.generatedImages` → `viewer.loraTrainerImages`.
- **BREAKING** The generated type names come from the field names, so they're renamed along with the fields: Relay input and payload types (`UpdatePhotoInput` → `DmbkPhotosUpdatePhotoInput`) and connection and edge types (`QueryPhotosConnection` → `QueryDmbkPhotosConnection`).
- Unchanged: cross-cutting fields that don't belong to either database (`_health`, `node`, `nodes`, `viewer`, `viewer.address`, `viewer.isAdmin`, `siweNonce`, `signInWithEthereum`). Node, object and enum type names (`Photo`, `LoraTraining`, `GeneratedImage`, …) and fields nested inside them (`LoraTraining.images`) also stay as they are. Global IDs encode the type name, so IDs already issued stay valid.
- The old names are removed outright, with no deprecated aliases.
- The convention is written down for later fields: the Phase 2 and Phase 3 fields planned in the roadmap are renamed to match (e.g. `reservePhotoUpload` → `dmbkPhotosReservePhotoUpload`).

## Capabilities

### New Capabilities
- `graphql-schema-naming`: the naming rule for root Query/Mutation fields and Viewer fields (database prefix, which fields are exempt), and the resulting field names the schema exposes.

### Modified Capabilities
<!-- None: openspec/specs/ has no existing capabilities. -->

## Impact

- Code: `src/schema/queries.ts`, `src/schema/mutations.ts`, `src/schema/types/viewer.ts`. No changes to repositories, models or visibility rules.
- Tooling: `scripts/test-mutations.ts` uses the old field and input-type names, so it has to be updated or it breaks.
- Docs: `README.md` (Queries/Mutations tables), `CLAUDE.md` and `AGENTS.md` if they mention field names, and `docs/plans/2026-10-08-migration-roadmap.md` (Phase 1 field list, the Phase 2/3 planned names, and the Phase 3 mapping of lora-trainer procedures to `viewer.*` fields).
- Deployment: merging to `main` deploys the renamed schema to production right away. Nothing consumes the API yet, so nothing breaks, but anyone exploring in GraphiQL has to switch to the new names.
