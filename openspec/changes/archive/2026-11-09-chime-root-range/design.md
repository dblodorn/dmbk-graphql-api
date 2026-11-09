# Design

## Context

`INT_FIELDS.root = [48, 84]` in `src/lib/chime/shape.ts` drives three things:
- the zod parse of `dmbkSoundSaveChimeComposition`;
- the `$jsonSchema` validator that `scripts/chime-compositions-collection.ts` applies;
- the GraphQL field description, through `range('root', …)`.

## Goals / Non-Goals

**Goals:** accept roots 0–119 everywhere a root is checked.

**Non-Goals:** changing titles, fingerprints or the stored shape.

## Decisions

- **Change the one constant.** Every check reads from `INT_FIELDS.root`, so nothing else needs editing.
- **Leave `schemaVersion` at 1.** Every existing document is still valid under the wider range.

## Risks / Trade-offs

- **The validator lags the code** until `--apply` runs. Until then the database still refuses roots outside 48–84 that the code would accept. Run `--apply` before the windchime release.
