# Tasks

## 1. Patch interface

- [x] 1.1 Add `SynthPatch` (implements `Node`: `id`, `name`, `data`) in `src/schema/types/vz.ts` and make `VzVoice` implement it; verify `npm run typecheck` and that the printed schema has `interface SynthPatch implements Node` and `type VzVoice implements Node & SynthPatch`

## 2. Chime unit `patch`

- [x] 2.1 Add `x:casio-vz: "CASIO VZ-10M"` at the end of `catalog.json`'s voices; verify `VOICE_IDS` includes it and `instrumentWord("x:casio-vz")` is `CASIO VZ-10M`
- [x] 2.2 In `shape.ts`, add `patch` to `ChimeUnit`, to the zod schema (24 lowercase hex or null, only for `x:` voices, normalized: external → always present, others → absent) and to `compositionJsonSchema` (not required); verify with a tsx check that valid, omitted, malformed and patch-on-non-external inputs parse or fail as the spec says
- [x] 2.3 Add `patch` to the Mongoose unit schema in `src/models/chime.ts`; verify a parsed external unit keeps `patch` through `new ChimeCompositionModel(doc).toObject()` and a non-external one gets no `patch` key
- [x] 2.4 Append `patch` to the fingerprint entry for `x:` units in `fingerprint.ts`; verify with a read-only tsx script that every stored composition's recomputed fingerprint equals its stored one, and that two units differing only in patch hash differently
- [x] 2.5 Add `ChimeUnit.patch` (nullable) and `ChimeUnitInput.patch` (optional) in `src/schema/types/chime.ts`, and update the `voice` description for `x:<synth>`; verify `npm run typecheck` and the printed schema
- [x] 2.6 Extend the chime suite in `scripts/test-mutations.ts`: an external unit with a patch and without, patch changes the fingerprint, patch on `v2` refused, malformed patch refused, `x:not-a-synth` refused; and a `SynthPatch` node lookup in the VZ suite; verify `npm run typecheck`

## 3. Docs

- [x] 3.1 Update `CLAUDE.md` (**Chime compositions**: `patch`, `x:` voices, the fingerprint rule; **Relay**: `SynthPatch`); verify by reading it back against the code

## 4. Roll out (needs the user's go-ahead: production database and deploy)

- [x] 4.1 Run `npm run chime:collection` (report) then `-- --apply` on production; verify the report shows `patch` in the validator and existing documents still validate
- [x] 4.2 Merge to `main` (deploys); verify the deploy job passes and `graphql.dmbk.network` serves `SynthPatch` and `ChimeUnit.patch`
- [x] 4.3 Run `npm run test:mutations` against a local server; verify the chime and VZ suites pass and fixtures are cleaned up
