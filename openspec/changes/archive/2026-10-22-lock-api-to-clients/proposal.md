# Proposal

## Why

graphql.dmbk.network is the private backend for dmbk-photo, dmbk and lora-trainer, but anything on the internet can call it. CORS (`ALLOWED_ORIGINS`) only stops browsers on other sites; curl, scripts and scrapers can still read the photo library, LoRA records and Are.na proxy. They also spend the API's shared anonymous Are.na budget (30 requests a minute) and its one 2 GB droplet. Every request should name the client app that sent it, and anything that doesn't should be confined to a small, rate-limited playground.

## What Changes

- **Per-client API keys.** Each client app (dmbk-photo, dmbk, lora-trainer, and any later ones) gets its own secret key. It sends the key in an `X-API-Key` header on every request. Keys are stored hashed, can be revoked one client at a time, and are created and revoked with an npm script, with no redeploy. Adding a client means issuing a key, not changing code.
- **Keys are server-side only.** A key is a secret, so it is sent only from a client's server: Next server components, route handlers, tRPC procedures, and the Relay network layer on the server or in a same-origin proxy route like dmbk-photo's admin `/api/admin/graphql`. A browser never holds a key. Relay fits this directly, because its network `fetchFn` is ours to write and adds the header in one place.
- **Session auth is unchanged and sits on top of the key.** `Authorization: Bearer <session>` still identifies the *person*. `X-API-Key` identifies the *app*. The playground tier ignores any session and runs as anonymous, so a stolen session token alone reaches no admin or owner-only data.
- **Playground tier for requests without a key.** GraphiQL stays at `/graphql`. Requests without a valid key are rate-limited per IP and may run queries only, with no mutations. Introspection stays on so the playground keeps working. Depth and cost limits apply so one query can't fan out across the Are.na proxy or the photo listing.
- **An invalid or revoked key is refused**, not downgraded: `UNAUTHENTICATED`, with the same generic message for every key failure. A wrong key in a client's config then fails loudly instead of silently running at playground limits.
- **BREAKING (client):** dmbk-photo's public gallery fetches later pages straight from the browser (`src/components/photos/usePhotoPages.ts` → `lib/dmbk-api.ts`). Those calls would fall to the playground tier. dmbk-photo needs a same-origin read proxy, or must render those pages on its server, before enforcement is switched on.
- **BREAKING (rollout):** enforcement is controlled by a flag. It ships off, so the API counts keyless traffic without blocking it. It is switched on once every client sends a key.

## Capabilities

### New Capabilities

- `api-access`: who may call the API and at what rate. Covers client API keys (issue, store, revoke, how they are presented), how a request is classified (keyed client, keyless playground, refused bad key), what the playground tier may do and its limits, the rollout flag, and how all of this combines with session auth and CORS.

### Modified Capabilities

(none. `accounts-auth` still states the bearer-session rules exactly. The key is a separate layer in front of them and changes none of their requirements.)

## Impact

- **Code:** new `lib/api-keys/` (hashing, lookup, the `api_clients` collection in `dmbk-accounts`) and a rate limiter (in memory: one droplet, one process). New Yoga plugins in `index.ts`, or an `onRequest` hook, for classifying requests, limiting rate, depth and cost, and refusing mutations without a key. `context.ts` gains the calling client. `errors.ts` gains a `RATE_LIMITED` mapping for the playground, a code Are.na already uses.
- **Env:** `API_KEYS_ENFORCED` (rollout flag), plus playground limit settings with defaults.
- **Scripts:** `npm run api-client -- create|list|revoke <name>`. `scripts/test-mutations.ts` must send a key (it issues itself one during `--setup`) and should cover the playground tier.
- **Clients:** dmbk-photo, dmbk and lora-trainer each get a `DMBK_GRAPHQL_API_KEY` server env var, sent by their server-side API callers (`src/server/auth/session.ts` in dmbk-photo and lora-trainer; the `/sound` fallback in dmbk's `src/lib/soundcloud/build-playlists.ts`). dmbk-photo's gallery browser reads move behind its server. These are client-repo changes, tracked here as rollout prerequisites.
- **Docs:** `CLAUDE.md` (env list, auth section) and the migration roadmap.
- **Not affected:** CORS stays as it is, as a second fence for browsers. Caddy, deploy and the data models are unchanged.
