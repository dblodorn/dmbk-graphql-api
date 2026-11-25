# Proposal

## Why

windchime is giving every saved composition its own address and making SHARE save the composition first (windchime change `composition-routes`). A visitor should be able to find the compositions they saved or shared again without an account, the way the dx7, vz10m and juno60 editors mark and list a browser's own patches with a device key. The compositions collection has no notion of who saved what.

## What Changes

- `dmbkSoundSaveChimeComposition` takes an optional `creatorKey` (a device key, 43 base64url characters).
- A newly created composition stores `creatorHash` = `sha256("chime-creator:" + key)`; the key is never stored. A duplicate save never changes an existing composition's owner. Keyless saves still work and store no owner.
- `ChimeComposition.yours(creatorKey)` and `dmbkSoundChimeCompositions(creatorKey)` (only that key's compositions).
- The collection validator allows an optional `creatorHash`; a new index `{ creatorHash, createdAt, _id }` serves the narrowed listing.
- Fingerprints, titles, duplicate rules, rate limits and hiding are unchanged. Nothing becomes editable or deletable.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chime-compositions`: device-key ownership (save, `yours`, listing filter) and the optional `creatorHash` in storage.

## Impact

- `src/lib/chime/` (shape, repository), `src/models/chime.ts`, `src/schema/types/chime.ts`, `src/schema/queries.ts`, `src/schema/mutations.ts`, `scripts/chime-compositions-collection.ts`.
- The validator must be re-applied (`npm run chime:collection -- --apply`), which needs dbAdmin on `dmbk-sound`.
- Backward compatible: older windchime builds don't send `creatorKey`.
