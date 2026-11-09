# Proposal

## Why

windchime is adding a second instrument, the furin bell (windchime's `furin-bell-instrument` change). It is a single bell playing one note, alongside the tube chime. A composition can mix both, so a saved composition has to record each unit's instrument, and the catalog has to know the new built-in FURIN voice. Without this, every save that includes a furin unit is refused, and a loaded composition would come back with its furin turned into a tube chime.

## What Changes

- **New unit field.** Each unit gains `instrument`, either `"chime"` (the tube chime) or `"furin"`. In the GraphQL API it is the enum `ChimeInstrument` with the values `CHIME` and `FURIN`.
  - **On input** it is optional, and an omitted value means `"chime"`, so the windchime currently deployed keeps saving unchanged.
  - **On output** it is always present, and stored units without it read as `"chime"`.
- **No migration.** The collection validator allows `instrument` but doesn't require it, so documents already stored stay valid without a backfill.
- **Fingerprints don't change.** A unit's fingerprint covers `instrument` only when it is `"furin"`, so every stored composition keeps its fingerprint, and saving an existing tube-chime composition again still finds it.
- **Titles.**
  - For a furin unit with the default voice, the instrument word is FURIN, not TUBULAR BELLS.
  - A furin unit's key is its root note alone (for example `D`), since a furin plays one note.
- **Catalog.** `catalog.json` gains the built-in voice `v6`, named `FURIN`, appended at the end.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chime-compositions`:
  - A unit carries an optional `instrument`.
  - The catalog includes the FURIN voice.
  - Fingerprints of tube-chime compositions are unchanged.
  - Titles name a furin unit's instrument and key as above.

## Impact

- **Code:**
  - `src/lib/chime/`: `shape.ts` (zod schema and validator), `fingerprint.ts`, `title.ts`, `catalog.ts`, and `catalog.json`.
  - `src/models/chime.ts`.
  - `src/schema/types/chime.ts`: the new enum, plus the field on `ChimeUnit` and `ChimeUnitInput`.
- **Collection validator.** It must be updated with `npm run chime:collection -- --apply`, which needs `dbAdmin` on `dmbk-sound`, **before** this deploys. The current validator refuses any field it doesn't list, so new code writing `instrument` would fail every save. The new validator, by contrast, accepts what the current code writes.
- **windchime** needs this deployed before it saves furin units. After the deploy it runs `pnpm schema:pull`.
- **The schema change is additive only.**
