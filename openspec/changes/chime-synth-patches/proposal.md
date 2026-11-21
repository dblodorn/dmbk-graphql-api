# Proposal

## Why

windchime is adding external synths as a unit's sound, starting with the Casio VZ-10M emulator (`@dblodorn/casio-vz-engine`), whose patches are the voices vz10m already saves here (`vz-voices`). A saved chime composition has to be able to say "this unit plays CASIO VZ-10M with that shared patch", and windchime has to fetch a patch without knowing each synth's GraphQL type. The reference must work for every emulator that follows (a DX7 next), not only the VZ. windchime's side is its change `add-vz10m-synth`.

## What Changes

- The catalog gains the external-synth voice `x:casio-vz` (CASIO VZ-10M). External synth voice ids are `x:<synth>`, where `<synth>` is the engine package name without `@dblodorn/` and `-engine`.
- A saved chime unit can hold `patch`: null (the synth's INIT patch) or the 24 lowercase hex characters of a patch's id in that synth's library. `patch` is allowed only on units whose voice is an external synth, is stored on every such unit, and is absent on every other unit. It is optional on input (omitted means INIT) and nullable on output.
- The fingerprint appends a unit's `patch` only for external-synth units, so every stored fingerprint, and the duplicate check for re-saved older compositions, is unchanged.
- The collection validator allows `patch` (string of 24 lowercase hex, or null) without requiring it.
- A new GraphQL interface `SynthPatch implements Node { id, name, data }`, implemented by `VzVoice`, so a client fetches any synth's patch with `node(id) { ... on SynthPatch { name data } }`. Each synth keeps its own collection and listing field.
- The API does not check that a referenced patch exists: patches can be deleted after a save anyway, and windchime falls back to INIT.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chime-compositions`: unit storage and input gain `patch`; the catalog gains external-synth voices; the fingerprint rule covers `patch`.
- `vz-voices`: `VzVoice` implements the new `SynthPatch` interface.

## Impact

- **Code:** `src/lib/chime/shape.ts` (zod, `$jsonSchema`, `ChimeUnit`), `fingerprint.ts`, `catalog.json`, `src/models/chime.ts` (Mongoose's strict unit schema would drop `patch` otherwise), `src/schema/types/chime.ts` (`ChimeUnit.patch`, `ChimeUnitInput.patch`), `src/schema/types/vz.ts` (`SynthPatch`), `scripts/test-mutations.ts`, `CLAUDE.md`.
- **Database:** `npm run chime:collection -- --apply` (a `collMod`, needs `dbAdmin`) **before** the code deploys. The new validator still accepts every stored document.
- **Clients:** additive schema change only; windchime's current build keeps working.
