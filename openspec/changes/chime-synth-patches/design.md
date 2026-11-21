# Design

## Context

See proposal.md. The full cross-repo design (the reference shape, windchime's link format, its synth registry) is windchime's `openspec/changes/add-vz10m-synth/design.md`, decisions 1 and 4. This file covers only the API's side.

## Decisions

### Patch reference: `voice: "x:<synth>"` + `patch`
External synths are one more voice family in the catalog (`x:casio-vz` → `CASIO VZ-10M`), so the voice check, the title's instrument word and the validator's voice enum work unchanged. The patch is a separate field holding the library document's `_id` as 24 lowercase hex characters, not a GraphQL global id. That's compact in windchime's links, exact to validate, and independent of id encoding. **Constraint on future synths:** their patch library must be a collection here keyed by a 24-hex `_id`, as every collection this API owns already is.

### Normalized on input
The zod schema accepts `patch` (24 lowercase hex or null) only when `voice` starts with `x:`, and refuses a patch on any other unit with `BAD_USER_INPUT`. After parsing, an external unit always carries `patch` (omitted → null), and any other unit carries no `patch` key at all. So a non-external unit's stored document and fingerprint input are exactly what they were before.

### Fingerprint
Entry = `UNIT_FIELDS` values, then `instrument` if not `chime` (as today), then `patch` if the voice starts with `x:`. An entry can't be confused across cases: `patch` is hex or null, never an instrument name, and the voice (already in the entry) says whether a patch follows. Verification: recompute the fingerprint of every stored composition with the new code and compare it with the stored value (read-only script run).

### `SynthPatch` interface
`interface SynthPatch implements Node { id: ID! name: String! data: String! }`, where `data` is the patch bytes as base64 (length per synth). `VzVoice` implements it with no field changes. Listing stays per synth (`dmbkSoundVzVoices`), because its arguments and limits are the library's own.

### Validator
`patch` is added to the unit's `properties` as `{ bsonType: ['string', 'null'], pattern: '^[0-9a-f]{24}$' }` and stays out of `required`. It is applied with `chime:collection -- --apply` before deploying, per the rule for new unit fields.

## Risks / Trade-offs

- [Validator applied after the deploy] → saves with a patch would fail at the database. Order the steps: apply, then merge.
- [A patch referenced by a saved composition is deleted] → nothing to do here; windchime falls back to INIT. The stored fingerprint still holds the old id, which is harmless.

## Migration Plan

1. Merge-ready branch, `npm run typecheck`, plus the fingerprint check against stored documents.
2. `npm run chime:collection -- --apply` on production (needs `dbAdmin`).
3. Merge to `main` (deploys), then run `npm run test:mutations` against a local server.
4. Rollback: revert the code. The validator change is additive and can stay.
