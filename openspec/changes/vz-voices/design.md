# Design

## Context

vz10m (Next.js 15 on Vercel, TypeScript, no database) edits VZ-10M voices as raw SysEx data and keeps them in `localStorage`. Its codec treats the bytes as the source of truth: every field is read and written by byte and mask. This API already stores anonymous chime compositions in `dmbk-sound` with a strict validator, a client key, per-visitor limits and admin hiding. VZ voices reuse all of that. What's new is ownership without accounts, and a user-visible name.

## Goals / Non-Goals

**Goals:** anonymous saves that their creator can later change or delete; a public, searchable listing; the bytes stored exactly as the instrument sends them; no obscene names in the public list.

**Non-Goals:** accounts; operations (multi-timbral setups) or banks, which vz10m keeps on the device; decoding parameters server-side; likes, tags or per-voice URLs; recovering a lost device key.

## Decisions

**Store the bytes, derive the rest.** `data` is the 336 decoded voice bytes (nibble-joined, no SysEx framing or checksum), base64: exactly 448 characters, checked with a regex before decoding. The name (bytes 322–333, trailing spaces trimmed) and a SHA-256 fingerprint are derived here. The API never parses parameters, so a later fix to vz10m's codec never invalidates stored voices. *Alternative:* store decoded parameters as fields. Rejected: the parameter map is still partly unverified against hardware, and the bytes are what the VZ accepts.

**Device key, stored hashed.** A device key is 32 random bytes from the browser's `crypto.getRandomValues`, base64url (43 characters, `^[A-Za-z0-9_-]{43}$`). The API stores `creatorHash = sha256("vz-creator:" + key)`, never the key, and never logs it. With that much entropy a plain hash is enough: there's nothing to brute-force, and a salted slow hash would only cost CPU on every listing with `creatorKey`. The key travels in the request body (as a mutation input or query argument), which is HTTPS from vz10m's server; it is not a session. *Alternatives considered:* the visitor's IP (changes, shared behind NAT, and personal data); a browser fingerprint (unreliable, and tracking); accounts (the user ruled them out). The cost: clear the browser and the voices become unchangeable. vz10m lets the user copy the key to another device.

**Ownership rules.** Update and delete look the voice up first: missing or hidden → `NOT_FOUND` (a hidden voice can't be told from a missing one); another key's → `FORBIDDEN`. The write then filters on `creatorHash` too, so a race can't change someone else's voice. Delete is real (`deleteOne`), unlike chime's hide-only model, because the creator asked for it. An admin can still hide, which also locks the creator out.

**Duplicates are per key.** The unique index is `{ creatorHash: 1, fingerprint: 1 }`. The same key saving the same bytes gets the stored voice back with `created: false` (race-safe through the 11000 error, as chime). Another key saving those bytes gets its own copy, because ownership is per key. Updating a voice to bytes the same key already saved is refused as `BAD_USER_INPUT`.

**`updatedAt` and order.** Save sets `createdAt = updatedAt`. Update changes only `updatedAt`, so the listing (keyset on `createdAt, _id`) doesn't reshuffle when someone tweaks a voice.

**`yours(creatorKey)`.** A field argument, not a context value, so one listing query can mark the caller's voices. It compares hashes and returns false for a malformed key rather than erroring, so a bad key in localStorage doesn't break the list.

**Names.** `lib/vz/names.ts` runs `obscenity`'s `RegExpMatcher` with the English dataset and recommended transformers (look-alike characters, repeated letters), then again on the name with spelled-out runs joined (`F U C K` → `FUCK`). Only runs of single characters are joined, so two real words never merge into a false positive. The check applies on save and update; already-stored names aren't re-checked, and admin hiding covers anything that slips through. vz10m runs the same package for instant feedback, but the API's check is the one that counts.

**Search.** A case-insensitive regex over `name`, with the text escaped and limited to 12 characters (a VZ name's length). It is not indexed: names are short, the public set is small, and the filter runs alongside `hidden: false`. Revisit with a text index if the collection grows past tens of thousands.

**Indexes** (created by `scripts/vz-voices-collection.ts`, never by Mongoose):
- `{ creatorHash: 1, fingerprint: 1 }` unique, for duplicates;
- `{ hidden: 1, createdAt: -1, _id: -1 }`, for the public listing;
- `{ creatorHash: 1, hidden: 1, createdAt: -1, _id: -1 }`, for one key's listing.

**Limits.** Every write (save, update, delete) takes from two in-memory token buckets, per `client:endUserIp` (default 60/hour) and per client (default 2000/day), via `limits.ts`. Higher than chime's because editing is iterative. Over limit → `VzWriteRateLimitedError` → `RATE_LIMITED` with `retryAfterSeconds`. Env: `VZ_WRITE_RATE_LIMIT`, `VZ_WRITE_RATE_WINDOW_SECONDS`, `VZ_WRITE_DAILY_LIMIT`.

**Schema surface** (prefixed per `graphql-schema-naming`):
- `Query.dmbkSoundVzVoices(first, after, creatorKey, search): DmbkSoundVzVoicesConnection`
- `Mutation.dmbkSoundSaveVzVoice(input: { data, creatorKey }) → { vzVoice, vzVoiceEdge, created }`
- `Mutation.dmbkSoundUpdateVzVoice(input: { id, data, creatorKey }) → { vzVoice }`
- `Mutation.dmbkSoundDeleteVzVoice(input: { id, creatorKey }) → { deletedVzVoiceId }`
- `Mutation.dmbkSoundSetVzVoiceHidden(input: { id, hidden }) → { vzVoice }`, admin scope

## Risks / Trade-offs

- **Lost key, lost control.** Expected for anonymous ownership; the voices stay public and an admin can hide them.
- **A leaked key** lets someone change or delete that key's voices. It never leaves the user's browser and vz10m's server, which forwards it over HTTPS.
- **Name filters miss things and occasionally over-block.** The error message tells the user to rename; admin hiding covers misses.
- **Atlas role.** `vz:collection --apply` needs `dbAdmin` on `dmbk-sound`; the API's runtime writes need `readWrite`. Granting one must not replace the other (it did once, on 2026-11-17, and briefly broke chime saves).

## Migration Plan

1. Create the collection (done, 2026-11-17) and land this change. New fields only; existing clients are unaffected.
2. Issue the `vz10m` key and set it in vz10m's Vercel env.
3. vz10m pulls the schema and builds its client (its own OpenSpec change).

Rollback: revert the code. The collection can stay; nothing else reads it.
