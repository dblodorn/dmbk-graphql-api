# Tasks

## 1. Implementation

- [x] 1.1 Add `src/lib/device-key.ts` (`creatorHash(salt, key)`, `BAD_USER_INPUT` on a malformed key); verify typecheck
- [x] 1.2 Validator and model: optional `creatorHash`; collection script adds the partial `creatorHash_1_createdAt_-1__id_-1` index; verify typecheck and `npm run chime:collection` reports the change
- [x] 1.3 Repository: `saveComposition(units, creatorKey?)` stores the hash on insert only; `listVisibleCompositions(args, { creatorKey })`; `isCompositionCreator(doc, key)`; verify on a scratch collection that a duplicate by another key keeps the first owner and fingerprints are unchanged
- [x] 1.4 Schema: `creatorKey` input on save, `yours(creatorKey)` on `ChimeComposition`, `creatorKey` argument on `dmbkSoundChimeCompositions`; verify `npm run schema` (printed schema) shows them and typecheck passes

## 2. Ship

- [x] 2.1 Apply the validator and index to `dmbk-sound.chime_compositions`, deploy, and verify on production that a keyed save sets `yours` and the narrowed listing returns it
