## 1. Shape and helpers

- [x] 1.1 `src/lib/vz/shape.ts`: `VOICE_BYTES` (336), `DATA_LENGTH` (448), `decodeVoice`, `voiceName`, `fingerprint`, `creatorHash`, and the collection's `$jsonSchema`
- [x] 1.2 `src/lib/vz/names.ts`: `isNameAllowed` with `obscenity` and the spelled-out pass

## 2. Model and collection

- [x] 2.1 `src/models/vz.ts` (`VzVoiceDoc`, `collection: 'vz_voices'` on `soundDb()`)
- [x] 2.2 `scripts/vz-voices-collection.ts` and `npm run vz:collection`: report-only by default; `--apply` creates or `collMod`s the validator and creates the three indexes
- [x] 2.3 Run it against production (`-- --apply`) and verify the validator and indexes

## 3. Repository, limits and errors

- [x] 3.1 `src/lib/vz/repository.ts`: save (dedupe per key), update, delete, list (key and search filters), load, hide, `isCreator`
- [x] 3.2 `src/lib/vz/limits.ts` and `VZ_WRITE_*` env settings
- [x] 3.3 `VzVoiceNotFoundError` and `VzWriteRateLimitedError` in `CODES`

## 4. Schema

- [x] 4.1 `src/schema/types/vz.ts`: `VzVoice` Node with `yours(creatorKey)` and admin `hidden`; the edge type
- [x] 4.2 `vzVoiceLoader` in `context.ts`, scoped by `viewer.isAdmin`
- [x] 4.3 `dmbkSoundVzVoices` query; save, update, delete and hide mutations
- [x] 4.4 `npm run typecheck` passes

## 5. Tests and docs

- [x] 5.1 A VZ suite in `scripts/test-mutations.ts`: save, dedupe, refusals (name, length, base64, key, keyless), listing, key filter, search, update, ownership, hide, delete, rate limit; fixtures removed by `--cleanup`
- [x] 5.2 `npm run test:mutations` passes against a local server
- [x] 5.3 `CLAUDE.md`: owner table, indexes, `vz:collection`, env, the Atlas role note, a **VZ voices** section

## 6. Ship

- [x] 6.1 PR merged (deploys to production) (#38)
- [x] 6.2 Issue the `vz10m` API key
- [x] 6.3 Archive this change once vz10m saves through it (2026-11-18: vz10m.dmbk.io shared, renamed and deleted a test voice through it)
