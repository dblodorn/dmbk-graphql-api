# Tasks

## 1. Unit shape

- [x] 1.1 Add `INSTRUMENTS = ['chime', 'furin']` and an optional `instrument` to `ChimeUnit` in `shape.ts`. The zod input is `z.enum(INSTRUMENTS).default('chime')`.
- [x] 1.2 Add `instrument` to the collection's `$jsonSchema` unit properties as an enum, not in `required`.
- [x] 1.3 Add `instrument` to the Mongoose unit schema in `models/chime.ts`.

## 2. Catalog, fingerprint, title

- [x] 2.1 Append `"v6": "FURIN"` to the voices in `catalog.json`.
- [x] 2.2 In `fingerprint.ts`, append the instrument to a unit's canonical entry only when it is `furin`.
- [x] 2.3 In `title.ts`, use FURIN as a furin unit's default instrument word, and make its key the root note alone.

## 3. GraphQL

- [x] 3.1 Add the `ChimeInstrument` enum, the non-null `ChimeUnit.instrument` (reading a missing value as `chime`), and the optional `ChimeUnitInput.instrument`.

## 4. Checks

- [x] 4.1 Run `npm run typecheck`.
- [x] 4.2 Check with a tsx script:
  - The fingerprints of tube-chime units with and without `instrument: 'chime'` match each other and the old hash.
  - A furin unit changes the fingerprint.
  - The titles for furin units are as specified.
  - The zod schema accepts `furin` and `v6`, and refuses `bell`.
  - The validator lists `instrument`, and does not require it.
- [x] 4.3 Update CLAUDE.md (and AGENTS.md if it mirrors it): the instrument field and the deploy order.

## 5. Rollout (by hand)

- [x] 5.1 Run `npm run chime:collection -- --apply` as a user with `dbAdmin` on `dmbk-sound`, **before merging**.
- [x] 5.2 Merge, which deploys. Then run `pnpm schema:pull` in windchime.
