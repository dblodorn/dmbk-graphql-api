# Proposal

## Why

Chime (windchime, chime.dmbk.io) can share a composition only as a link, and a link only reaches the people it is sent to. Visitors should be able to save a composition anonymously to a public list that anyone can browse and load. The list needs a store and a write path. This API already serves `dmbk-sound`, so it is the place for them. Windchime has no database and should not get one.

## What Changes

- A new collection `dmbk-sound.chime_compositions`, **owned by this API**. It is created by a one-off script with a MongoDB `$jsonSchema` validator (`validationLevel: strict`, `validationAction: error`, `additionalProperties: false`), so the database itself refuses any document that doesn't fit, whatever writes it.
- A `ChimeComposition` Node type (global ID, title, created time, units). Each `ChimeUnit` holds the chime's settings as named integers at the slider steps windchime's share links already use (volume %, tubes, wind %, decay ×10, cutoff ×1000, resonance ×10, root, scale name, voice id, channel, MIDI mode, notes shown, x, y, stacking rank).
- `dmbkSoundChimeCompositions(first, after)`: a public, forward-only, newest-first connection of visible compositions.
- `dmbkSoundSaveChimeComposition(input: { units })`: an anonymous save. No session is needed and no account is recorded. The input is validated strictly (1–16 units, every field typed and in range, scale and voice from a known catalog, unknown fields refused). The API, not the client, generates the title from the composition: unit count, key, and instrument. Saving a composition identical to one already stored returns the stored one rather than a duplicate.
- `dmbkSoundSetChimeCompositionHidden(id, hidden)`: admin-only, for removing abuse from the public list.
- Save rate limits: a per-end-user budget, using the user's IP as forwarded by the calling client, and a per-client daily ceiling. Keyless (playground) requests stay query-only, so saves always come through a client app's server with its key.
- A catalog of windchime's scale names and voice ids/names, copied into this repo from windchime. It is append-only, matching windchime's index rule. It is used for validation and for titles.
- The `sound-playlists` ownership rule changes: dmbk still owns `sound_snapshots`, and this API now owns `chime_compositions` in the same database.

## Capabilities

### New Capabilities
- `chime-compositions`: storing, validating, titling, listing, saving and hiding windchime compositions in `dmbk-sound.chime_compositions`.

### Modified Capabilities
- `sound-playlists`: "Sound data lives in dmbk-sound" no longer makes dmbk the database's only writer. Ownership becomes per collection.
- `api-access`: adds how a keyed client passes its end user's IP, so per-user limits work for requests that arrive from a client's server.

## Impact

- New: `src/models/chime.ts`, `src/lib/chime/` (repository, validation, catalog, title, fingerprint), `src/schema/types/chime.ts`, a collection-setup script under `scripts/`, and `test-mutations` coverage.
- Changed: `src/schema/queries.ts`, `src/schema/mutations.ts`, `src/errors.ts` (`CODES`), `src/lib/api-access/` (end-user IP), `src/env.ts` (save-limit settings), `CLAUDE.md` (DB table, indexes), and the public schema, which windchime's Relay compiler and lora-trainer's checked-in copy pull.
- Operations: run the collection script against production once. Issue a `windchime` API key (`npm run api-client -- create windchime`). No CORS change, because windchime calls from its server.
- No change to existing types, fields or the `sound_snapshots` document.
