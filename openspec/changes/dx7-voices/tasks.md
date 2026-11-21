# Tasks

- [x] 1.1 `lib/synth-voices/` (shape, repository, limits, names) and `models/synth-voice.ts`; `lib/vz/` and `models/vz.ts` rebuilt on them. Verify: typecheck; `npm run vz:collection` reports the validator up to date; creator hashes unchanged.
- [x] 1.2 `lib/dx7/`, `models/dx7.ts`, `schema/types/dx7.ts` (implements SynthPatch), `dmbkSoundDx7Voices`, the four mutations, the loader, errors, `env.dx7Writes`; `isTypeOf` checks the data length on both types. Verify: the schema builds; SynthPatch's implementations are Dx7Voice and VzVoice.
- [x] 1.3 `scripts/synth-voices-collection.ts` shared; `npm run dx7:collection`; `dx7_voices` created with `--apply`. Verify: the report shows the collection and three indexes.
- [x] 1.4 DX7 suite in `scripts/test-mutations.ts`; `--cleanup` removes DX7 fixtures. Verify: `npm run test:mutations` 211 passed, 0 failed.
- [x] 1.5 `CLAUDE.md` / `AGENTS.md`: synth voices, DX7 voices, the env vars, `dx7:collection`.
