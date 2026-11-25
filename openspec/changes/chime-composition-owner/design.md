# Design

## Context

See proposal.md. The synth libraries (`src/lib/synth-voices/`) already hash a device key per library (`creatorSalt`) and expose `yours(creatorKey)` and a `creatorKey` list filter. Compositions are saved by `saveComposition` in `src/lib/chime/repository.ts`: it inserts and, on a duplicate fingerprint (unique index), returns the stored document.

## Goals / Non-Goals

**Goals:** the same key format and hashing as the synth libraries, salted `chime-creator`; ownership never transferred by a duplicate; existing documents and fingerprints untouched.

**Non-Goals:** updating or deleting compositions; claiming owner-less compositions; per-key duplicates (duplicates stay global, one composition per fingerprint).

## Decisions

- **Hash on insert only.** `creatorHash` is part of the new document passed to `create`; the duplicate path reads the stored document and returns it untouched. No update ever writes `creatorHash`, so a duplicate can't move ownership. (Equivalent to `$setOnInsert`, without changing the insert.)
- **Shared key check.** The 43-character pattern and hashing move into a small helper (`src/lib/device-key.ts`, `creatorHash(salt, key)`), used by the chime repository; the synth shape keeps its own copy to avoid churn in five libraries.
- **Validator.** `creatorHash: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' }` in `properties`, not in `required`.
- **Index.** `{ creatorHash: 1, createdAt: -1, _id: -1 }`, partial on `creatorHash` existing, matching the listing's sort.
- **The key validates before the rate limit is taken?** No: the limit is taken first, as today, so a malformed-key request still costs a save (consistent with other refused saves).

## Risks / Trade-offs

- [collMod needs dbAdmin] → run the collection script with a user that has it, as for earlier validator changes.
- [Someone else's earlier identical save keeps the composition theirs] → by design; the spec says so.

## Migration Plan

Deploy the code (save still works without a key), then apply the validator and index. Rollback: revert the code; stored `creatorHash` fields stay valid under the old validator only if it allows them, so re-apply the old validator only after removing them (not expected).
