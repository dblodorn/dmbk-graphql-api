# Proposal

## Why

vz10m (vz10m.dmbk.io) is a browser editor and emulator for the Casio VZ-10M. Its voices live only in the browser that made them. Visitors should be able to save a voice to a public list that anyone can browse and load, and come back later to rename, update or delete their own, without accounts. The API already serves `dmbk-sound`, so the store and write path belong here, as they did for chime compositions.

## What Changes

- A new collection `dmbk-sound.vz_voices`, **owned by this API**, created by a one-off script with a strict `$jsonSchema` validator (`additionalProperties: false`), like `chime_compositions`.
- A voice is stored as its raw data: the 336 decoded bytes of a VZ voice SysEx dump, base64. The API reads the name from the bytes (bytes 322–333), so no free-text name is ever taken from the client.
- **Ownership without accounts: a device key.** The browser generates a random 32-byte secret (base64url, 43 characters) and sends it with each write. The API stores only `sha256("vz-creator:" + key)`. Whoever holds the key can update and delete that key's voices and filter the listing to them; anyone else gets `FORBIDDEN`. Losing the key means losing control of those voices, never their visibility.
- Obscene names are refused (`BAD_USER_INPUT`) on save and update, using the `obscenity` package's English set plus a pass that joins letters spelled out one by one.
- `dmbkSoundVzVoices(first, after, creatorKey, search)`: a public, forward-only, newest-first connection. `creatorKey` narrows it to one key's voices; `search` matches names case-insensitively (at most 12 characters).
- `VzVoice { id name data createdAt updatedAt yours(creatorKey) hidden }`. `yours` lets a client mark its own voices in the public list without a second query; `hidden` is admin-only.
- Mutations: `dmbkSoundSaveVzVoice(data, creatorKey)` (returns the stored voice with `created: false` when the same key saves the same bytes again), `dmbkSoundUpdateVzVoice(id, data, creatorKey)`, `dmbkSoundDeleteVzVoice(id, creatorKey)`, and admin `dmbkSoundSetVzVoiceHidden(id, hidden)`.
- Writes need a client key and are rate-limited per visitor (`X-End-User-IP`) and per client per day, as chime saves are.
- Voices only. Banks stay on the device (vz10m keeps them in local SQLite).

## Capabilities

### New Capabilities
- `vz-voices`: storing, validating, listing, saving, updating, deleting and hiding VZ voices in `dmbk-sound.vz_voices`.

### Modified Capabilities
- `sound-playlists`: adds `vz_voices` to the collections of `dmbk-sound` this API owns.

## Impact

- New: `src/models/vz.ts`, `src/lib/vz/` (shape, names, limits, repository), `src/schema/types/vz.ts`, `scripts/vz-voices-collection.ts` (`npm run vz:collection`), `test-mutations` coverage, the `obscenity` dependency.
- Changed: `src/schema/queries.ts`, `src/schema/mutations.ts`, `src/context.ts` (`vzVoiceLoader`), `src/errors.ts` (`CODES`), `src/env.ts` (write limits), `CLAUDE.md`, and the public schema that vz10m's Relay compiler pulls.
- Operations: the collection was created in production with `npm run vz:collection -- --apply` (2026-11-17). The `graphql-api` Atlas user needs `readWrite` **and** `dbAdmin` on `dmbk-sound`. Issue a `vz10m` API key (`npm run api-client -- create vz10m`).
