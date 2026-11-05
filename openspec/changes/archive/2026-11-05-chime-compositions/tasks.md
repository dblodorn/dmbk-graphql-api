## 0. Before starting

- [x] 0.1 windchime's `scripts/catalog.mjs` (task 1.1 of its `save-compositions` change) exists and prints the catalog JSON

## 1. Shape, catalog and pure helpers

- [x] 1.1 Add `src/lib/chime/catalog.json`, copied from windchime's `pnpm catalog` output, and a typed loader `catalog.ts` (scale names, voice id → display name)
- [x] 1.2 Add `src/lib/chime/shape.ts`: one table of unit fields (type, integer range, enum source), plus the zod input schema and the `$jsonSchema` (document and unit, `additionalProperties: false`, all `required`) built from it
- [x] 1.3 Add `src/lib/chime/fingerprint.ts`: SHA-256 of the units in canonical key order
- [x] 1.4 Add `src/lib/chime/title.ts`: seeded pick of key, instrument and template, ensemble words, instrument name normalisation, 40-character rule
- [x] 1.5 Check the helpers with a throwaway `tsx` script: the same units give the same fingerprint and title, different positions give a different fingerprint, every title is at most 40 characters for 16 mixed units, and every catalog voice name normalises

## 2. Model and collection

- [x] 2.1 Add `src/models/chime.ts` (`ChimeCompositionDoc`, nested unit type, `collection: 'chime_compositions'` on `soundDb()`, house doc options)
- [x] 2.2 Add `scripts/chime-compositions-collection.ts` and the `chime:collection` npm script: report-only by default; `--apply` creates the collection with the validator (strict / error) or `collMod`s it, and creates `{ fingerprint: 1 }` unique and `{ hidden: 1, createdAt: -1, _id: -1 }`
- [x] 2.3 Run it against a throwaway collection (`-- --apply --collection chime_compositions_scratch`; the API's user can't create other databases). Confirm that raw inserts with an extra field, a float volume, `tubes: 9` or a missing `scale` are each rejected by MongoDB, and a valid document is accepted. Then drop the collection

## 3. Repository and errors

- [x] 3.1 Add `src/lib/chime/repository.ts`: `saveComposition(units)` (validate → fingerprint → title → insert, duplicate-key → existing with `created: false`), `listVisible(args)` (keyset, `hidden: false`), `loadCompositions(ids, isAdmin)`, `setHidden(id, hidden)`
- [x] 3.2 Add `ChimeCompositionNotFoundError` and `RateLimitedError` (with retry seconds) to `src/errors.ts` `CODES` (`NOT_FOUND`, `RATE_LIMITED`); map zod failures to `InvalidInputError` messages naming `units[i].field`

## 4. End-user IP and save limits

- [x] 4.1 In `src/lib/api-access/plugin.ts`, read `X-End-User-IP` for **client** requests only, keep it when `net.isIP()` accepts it, and pass `endUserIp` into the context (`context.ts`); never log it
- [x] 4.2 Add `CHIME_SAVE_RATE_LIMIT` (10), `CHIME_SAVE_RATE_WINDOW_SECONDS` (3600) and `CHIME_SAVE_DAILY_LIMIT` (500) to `src/env.ts`
- [x] 4.3 Two `createRateLimiter` instances for saves: per `client:endUserIp` (or `client:unknown`) and per client per day

## 5. Schema

- [x] 5.1 Add `src/schema/types/chime.ts`: `ChimeComposition` Node (loader-backed, `hidden` admin-scoped with `unauthorizedResolver: () => null`), `ChimeUnit`, `ChimeMidiMode` enum, `ChimeUnitInput`
- [x] 5.2 Add the `compositionLoader` to `src/context.ts`, scoped by `viewer.isAdmin`
- [x] 5.3 Add `dmbkSoundChimeCompositions` to `schema/queries.ts` (forward-only connection)
- [x] 5.4 Add `dmbkSoundSaveChimeComposition` (rate-limited, no auth scope) and `dmbkSoundSetChimeCompositionHidden` (admin) to `schema/mutations.ts`, returning the repository result
- [x] 5.5 `npm run typecheck` passes, and GraphiQL shows the new fields and types

## 6. Tests

- [x] 6.1 Add a chime suite to `scripts/test-mutations.ts`:
  - save, duplicate, invalid (out of range, unknown scale/voice, extra field, 0 and 17 units);
  - keyless save refused under the playground;
  - per-IP limit through `X-End-User-IP`, and two IPs limited separately;
  - listing and paging, `node(id)`;
  - hide by admin, hide refused for non-admin, listing omits hidden.
- [x] 6.2 The suite deletes every composition it created (tracked by id) and resets the limiters by using unique fake IPs per run
- [x] 6.3 Run the full `npm run test:mutations` against a local server, with and without `API_KEYS_ENFORCED=true`

## 7. Docs and rollout

- [x] 7.1 `CLAUDE.md`:
  - `dmbk-sound` row of the DB table (per-collection owners) and the indexes list;
  - catalog steps (windchime `pnpm catalog` → copy → re-run `chime:collection` → deploy);
  - `X-End-User-IP`, and the new env vars.
- [x] 7.2 Open the PR. After merge and deploy, run `npm run chime:collection` (report), then `-- --apply` against production, and confirm with a `dmbkSoundChimeCompositions` query
- [x] 7.3 Issue the windchime key (`npm run api-client -- create windchime`) and give it to windchime's Vercel env as `DMBK_GRAPHQL_API_KEY` (operator step, done by the user)
