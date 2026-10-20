# Design

## Context

The schema is built with Pothos. Root fields are registered in `src/schema/queries.ts` and `src/schema/mutations.ts`, and the per-wallet LoRA connections live in `src/schema/types/viewer.ts`. Pothos derives several type names from the field name:

- `relayMutationField('updatePhoto', …)` → `UpdatePhotoInput` / `UpdatePhotoPayload`
- `queryField('photos', t => t.connection(…))` → `QueryPhotosConnection` / `QueryPhotosConnectionEdge`
- `Viewer.generatedImages` → `ViewerGeneratedImagesConnection`

Renaming the field therefore renames those types too. Node types (`Photo`, `LoraTraining`, `GeneratedImage`) are named explicitly and are part of every global ID (`base64("Photo:<uuid>")`). The production schema is live, but no client uses it yet (see proposal.md, Why).

## Goals / Non-Goals

**Goals:**
- Only the field names in the schema change. Resolvers, repositories and visibility rules stay byte-for-byte the same.
- `npm run test:mutations` still passes against the renamed schema.

**Non-Goals:**
- Renaming node, object or enum types, or nested fields on them.
- Renaming repository functions or TypeScript identifiers (`listPhotos`, `PhotoRef`, …). The prefix is a schema-surface convention only.
- Adding a committed SDL snapshot or a lint rule that enforces the prefix. The spec and a note in `CLAUDE.md` cover it for now.

## Decisions

**Prefix = database name, not collection name.** The request said "collection name," but the examples given (`dmbkPhotos`, `loraTrainer`) are the database names, and a collection prefix would split one app across several prefixes (`photos`, `keywords`, `soundSnapshots`). The database maps one-to-one onto the owning app, and that's the boundary the Phase 4 migration is organized around.

**Drop words the prefix already says.** Chosen by the user over a strict prefix: `dmbkPhotos` rather than `dmbkPhotosPhotos`, `loraTrainerTrainings` rather than `loraTrainerLoraTrainings`, `loraTrainerSetImageHidden` rather than `loraTrainerSetGeneratedImageHidden`. `dmbkPhotosUpdatePhoto` and `dmbkPhotosSetPhotoHidden` keep `Photo` because the verb needs an object, and the user approved those exact names.

**Let Pothos derive input, payload and connection type names.** The alternative was to pin the old names with explicit `name:` options, which would avoid breaking type names. That would leave `UpdatePhotoInput` next to `dmbkPhotosUpdatePhoto`, so the convention would only be half applied, and nothing depends on the old type names yet. The only override is wherever a derived name would come out wrong. None are expected.

**Keep payload node keys (`photo`, `loraTraining`, `generatedImage`).** They name the node type that comes back, not the database, and Relay clients select them by type. Prefixing them would add noise and buy nothing.

**No deprecated aliases.** With no consumers, aliases would only double the surface and need a removal step later. Old names are removed in the same commit.

**Viewer fields are prefixed; `viewer` itself is not.** `viewer` belongs to SIWE auth and spans both databases. Its database-backed children follow the same rule as root fields, which also sets the pattern for Phase 3's remaining-quota field (e.g. `viewer.loraTrainerRemainingGenerations`).

## Risks / Trade-offs

- [Someone exploring production in GraphiQL hits validation errors after deploy] → The README tables are updated in the same PR. The error message names the unknown field.
- [The roadmap's Phase 2/3 names drift from the convention] → Rename them in the roadmap as part of this change, so the next phase starts from prefixed names.
- [A missed reference in `scripts/test-mutations.ts` only shows up at runtime, since the GraphQL strings aren't type-checked] → Run `npm run test:mutations` against a local server before merging, and grep for every old name afterwards.

## Migration Plan

1. Rename the fields in a branch, then update the test script and docs.
2. Check locally: `npm run typecheck`, print the schema and confirm no old names remain, then run `npm run test:mutations`.
3. Merge to `main`. The deploy workflow ships it.
4. Rollback: revert the merge commit. Nothing persisted changes, so the revert is safe at any time.
