# Design

## Decisions

**`instrument` is optional and defaults to `"chime"`, kept out of `UNIT_FIELDS`.**
- `UNIT_FIELDS` is both the validator's `required` list and the fingerprint's canonical order, so adding `instrument` there would mean a backfill and a new fingerprint for every stored composition. It stays a separate optional field instead.
- The zod input defaults it to `"chime"`, so every new document stores it.
- Readers use `unit.instrument ?? "chime"` for older documents.
- No backfill is needed. `schemaVersion` stays 1, because every version 1 document is still valid as written.

**The fingerprint includes `instrument` only when it is `"furin"`.**
- A unit's fingerprint entry is its `UNIT_FIELDS` values. For a furin unit, `"furin"` is appended.
- A tube-chime composition therefore hashes exactly as before, and duplicate detection keeps working across old and new documents.
- A furin unit and a tube chime with otherwise identical values hash differently, because one entry is longer.

**Deploy order: validator first, then code.**
- The current validator has `additionalProperties: false`, so it would reject new documents with `instrument`.
- The new validator lists `instrument` (enum `chime` | `furin`, not required) and `v6`, so it accepts the documents the current code writes.
- The safe order is `chime:collection -- --apply` (as a `dbAdmin` user), then merge.

**Titles.**
- `voiceName(null)` stays TUBULAR BELLS for a tube chime. The default voice of a furin unit reads as FURIN, which is windchime's default voice for a furin.
- A furin unit's key is only `NOTES[root % 12]`. The scale name would be misleading, because a furin unit plays ROOT alone (windchime keeps its scale value hidden).

**GraphQL.**
- The enum `ChimeInstrument` (`CHIME` → `"chime"`, `FURIN` → `"furin"`) follows `ChimeMidiMode`.
- The `ChimeUnitInput.instrument` input is optional. `ChimeUnit.instrument` is non-null.

## Risks

- **If the code deploys before the validator update, every save fails** with a validation error and is masked as "Unexpected error". The tasks put the validator first, and the PR says so.
- **`catalog.json` is updated ahead of windchime.** The `v6` entry is written to match the `pnpm catalog` output windchime will produce once it has added the FURIN voice. That output gets diffed against this file before windchime ships.
