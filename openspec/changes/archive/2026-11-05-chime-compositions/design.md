# Design

## Context

windchime (Next.js 15 on Vercel, plain JS, no database) keeps compositions in `localStorage` and shares them as `#c=` links (binary v1, `lib/share.js`). A composition is 1–16 units. Each unit is a handful of slider values, a scale name, a voice id, MIDI settings and a position. The share format already fixes each value's step and range as an integer (`PackedUnitSchema`). Saved compositions reuse those integers so the two formats agree exactly.

This API: Pothos + Yoga + Mongoose, `autoIndex`/`autoCreate` off, string `_id`s, ISO strings, layered `models/` → `lib/*/repository.ts` → `schema/`. Mutations need a client key (`api-access`). Keyed clients call from their own servers, so the API sees the client's server IP, not the visitor's. `dmbk-sound` today holds only dmbk's `sound_snapshots`.

The work spans this repo and windchime, which has its own OpenSpec change, `save-compositions`. Order of work:
1. windchime adds `scripts/catalog.mjs`, which prints the catalog JSON. It is tiny and independent.
2. This change lands and deploys, the collection is created, and a `windchime` key is issued.
3. windchime pulls the schema and builds the Relay client and the panel.

## Goals / Non-Goals

**Goals:** strict validation at two layers (API input and MongoDB validator); titles that no client can write; a public, paginated, cheap listing; a basic defence against anonymous abuse.

**Non-Goals:** accounts or ownership of compositions; editing or deleting by the saver; search, tags, likes or play counts; per-composition URLs (windchime keeps share links for that); bot detection beyond rate limits (Vercel BotID could come later, in windchime's proxy).

## Decisions

**One shape definition, two validators.** `src/lib/chime/shape.ts` declares each unit field's type and integer range once. A zod schema (zod 4 is already a dependency) built from it validates mutation input in the repository and produces `BAD_USER_INPUT` messages with the unit index and field. A `$jsonSchema` built from the same table is what the setup script installs on the collection (`bsonType: "int"` with `minimum`/`maximum`, `enum` for scale names and `midiMode`, `additionalProperties: false` at every level, `required` everywhere). This keeps the two layers from drifting. The DB validator is the backstop against a bug or another writer; the zod layer gives the friendly errors. *Alternative:* rely on Mongoose `strict` + validators. Rejected: Mongoose only covers this process, and the user asked for the database to enforce it.

**Integers, not floats.** The units are stored at the share link's steps: volume %, wind %, decay ×10, cutoff ×1000, resonance ×10. Range and step checks are then exact (`bsonType: "int"`), and a saved composition round-trips through a share link unchanged. The field names are readable (`cutoff`, `resonance`), not the share format's bit-packed flags.

**Collection setup is a script, not Mongoose.** `scripts/chime-compositions-collection.ts`, in the style of the existing scripts: report-only by default; `-- --apply` creates the collection with the validator (`validationLevel: "strict"`, `validationAction: "error"`) or, if it exists, `collMod`s the validator to the current shape, and creates the indexes:
- `{ fingerprint: 1 }` **unique**, for the duplicate rule and the race between two identical saves;
- `{ hidden: 1, createdAt: -1, _id: -1 }`, for the public listing's keyset sort.

The script must be re-run whenever the catalog grows, because the scale enum lives in the validator. The catalog's tasks say so, and so does `CLAUDE.md`.

**The catalog is copied from windchime.** `src/lib/chime/catalog.json` holds `{ scales: [names…], voices: { "v0": "TUBULAR BELLS", …, "s0:12": "Flute TB", … } }`, produced by windchime's `pnpm catalog`, which reads `SCALE_LIST`, `VOICES` and the bundled SF2's preset names. Both repos are append-only on it already, because the share links store indices. *Alternative:* accept any scale/voice string matching a pattern. Rejected: not strict, and the title would then echo client text. *Alternative:* fetch the catalog from windchime at runtime. Rejected: a runtime dependency on another app for validation.

**Server-generated titles.** `src/lib/chime/title.ts`: a small PRNG seeded from the fingerprint picks one unit for the key, one for the instrument, and a template, for example `{KEY} {INSTRUMENT}`, `{INSTRUMENT} {ENSEMBLE} IN {KEY}` or `{KEY} {ENSEMBLE}`. Instrument display names are normalised to upper case without parenthesised parts (`BAMBOO (WOODBLOCK)` → `BAMBOO`, `Flute TB` → `FLUTE TB`), then the 40-character rule applies. Deterministic, so duplicates and re-reads agree. No free text from anonymous users reaches the public list, which removes the moderation problem titles would otherwise be.

**Fingerprint and duplicates.** SHA-256 over the units serialised with a fixed key order and in page order. Save = validate → fingerprint → `insertOne`. On a duplicate-key error (11000) on `fingerprint`, read the existing document and return it with `created: false`. Race-safe without a transaction.

**Ids and dates.** `_id` = 12 random bytes as hex (the same form as `lib/lora/ids.ts`'s new ids), `createdAt` = ISO string, `schemaVersion: 1`, all per house conventions. `ChimeComposition` is a Pothos Node (`ChimeComposition:<hex>`). The listing uses `lib/cursor.ts`'s `(createdAt, _id)` keyset, forward-only, like the photo and LoRA connections.

**Visibility in the repository.** `lib/chime/repository.ts` owns `{ hidden: false }` for the public scope and the admin scope, as the photo repository does. A per-request `compositionLoader` in `context.ts` is pre-scoped to the viewer. `hidden` is an admin-scoped field with `unauthorizedResolver: () => null`.

**Schema surface** (prefixed per `graphql-schema-naming`):
- `Query.dmbkSoundChimeCompositions(first, after): ChimeCompositionConnection`
- `Mutation.dmbkSoundSaveChimeComposition(input: { units: [ChimeUnitInput!]! }) → { chimeComposition, chimeCompositionEdge, created }`. The edge, like `dmbkPhotos`' finalize edge, lets a client `@prependEdge` it. The mutation refuses requests without a client key even while enforcement is off
- `Mutation.dmbkSoundSetChimeCompositionHidden(input: { id, hidden }) → { chimeComposition }`, with `authScopes: { admin: true }`
- `ChimeComposition { id title createdAt unitCount units hidden }`, `ChimeUnit { volume tubes wind decay cutoff resonance root scale voice channel midiMode notes x y rank }`. `midiMode` is a GraphQL enum `ChimeMidiMode { POLY MONO }`, stored lower-case.

**End-user IP and limits.** The api-access plugin already classifies requests before parsing. For a **client** request it reads `X-End-User-IP`, keeps it only if `net.isIP()` accepts it, and puts it on the context as `endUserIp`. It is never logged. Other tiers never read it. The save resolver takes from two `createRateLimiter` instances (the existing token-bucket module): one per `client:endUserIp` (or `client:unknown`), defaulting to 10/hour, and one per client, defaulting to 500/day. Limits are in memory like the playground's: one process, and a restart only resets them. Over limit → a `RateLimitedError` → `RATE_LIMITED` with `retryAfterSeconds` in `extensions`. Env: `CHIME_SAVE_RATE_LIMIT`, `CHIME_SAVE_RATE_WINDOW_SECONDS`, `CHIME_SAVE_DAILY_LIMIT`.

## Risks / Trade-offs

- **Anonymous writes invite spam.** Mitigations: the client key (only windchime's server can save), per-visitor and per-client limits, duplicate collapse, titles with no user text, and admin hiding. A determined attacker rotating IPs through windchime is capped by the daily ceiling. Raise or lower it by env without a deploy of code.
- **Catalog drift.** If windchime adds a scale or font preset and the catalog isn't copied, saves using the new one fail with `BAD_USER_INPUT` (safe, visible). Recorded in both repos' `CLAUDE.md`, with the steps in order: `pnpm catalog` there, then copy here, then re-run the collection script, then deploy.
- **The `X-End-User-IP` header is trusted from any keyed client.** Acceptable: key holders are our own servers. A leaked key is already a bigger problem, and revocation is instant.
- **Positions are viewport offsets.** A composition saved on a wide screen loads clamped on a phone. Same as share links today; windchime handles it.
- **Shared droplet.** Writes are tiny (under 2 KB per document) and the listing is indexed. No meaningful load.

## Migration Plan

1. Land the change behind no flag. New fields only, so existing clients are unaffected.
2. Deploy, then run `npm run chime:collection -- --apply` against production (report first without `--apply`).
3. `npm run api-client -- create windchime`, and hand the key to windchime's Vercel env (`DMBK_GRAPHQL_API_KEY`).
4. Rollback: revert the deploy. The collection can stay, or be dropped by hand if empty.

## Open Questions

- The default limits (10/hour per visitor, 500/day per client) are guesses. Confirm or set others.
