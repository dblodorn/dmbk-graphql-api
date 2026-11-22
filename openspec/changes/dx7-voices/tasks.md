# Tasks

- [x] 1.1 `lib/synth-voices/` (shape, repository, limits, names) and `models/synth-voice.ts`; `lib/vz/` and `models/vz.ts` rebuilt on them. Verify: typecheck; `npm run vz:collection` reports the validator up to date; creator hashes unchanged.
- [x] 1.2 `lib/dx7/`, `models/dx7.ts`, `schema/types/dx7.ts` (implements SynthPatch), `dmbkSoundDx7Voices`, the four mutations, the loader, errors, `env.dx7Writes`; `isTypeOf` checks the data length on both types. Verify: the schema builds; SynthPatch's implementations are Dx7Voice and VzVoice.
- [x] 1.3 `scripts/synth-voices-collection.ts` shared; `npm run dx7:collection`; `dx7_voices` created with `--apply`. Verify: the report shows the collection and three indexes.
- [x] 1.4 DX7 suite in `scripts/test-mutations.ts`; `--cleanup` removes DX7 fixtures. Verify: `npm run test:mutations` 211 passed, 0 failed.
- [x] 1.5 `CLAUDE.md` / `AGENTS.md`: synth voices, DX7 voices, the env vars, `dx7:collection`.
- [x] 2.1 `npm run dx7:import` (DX7 voices and 32-voice banks, `DX7_IMPORT_KEY`), then the factory voices: Yamaha's ROM1A–ROM4B cartridges, from Dave Benson's DX7 page (`dx7patch.zip`, https://homepages.abdn.ac.uk/d.j.benson/pages/html/dx7.html). Verify: 256 voices read with valid checksums; 242 saved, 14 byte-identical repeats across cartridges.
- [x] 2.2 Banks: `dx7_banks` (`lib/dx7/banks.ts`, `Dx7Bank`, `dmbkSoundDx7Banks`, save, update, delete and hide; slots as Dx7Voice global IDs); `npm run dx7:banks-collection -- --apply`; bank checks in the mutation suite. Verify: `npm run test:mutations` 224 passed, 0 failed.
- [x] 2.3 `dx7:import --apply --banks` the factory files. Verify: banks ROM1A–ROM4B, 32 slots each, in cartridge order.

