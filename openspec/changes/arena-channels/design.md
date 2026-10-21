# Design

## Context

- **Are.na v3 API** (from `https://api.are.na/v3/openapi.json`, and checked anonymously on 2026-10-21):
  - `GET /v3/users/{id|slug}` returns a user (`id`, `slug`, `name`, `avatar`).
  - `GET /v3/users/{id|slug}/contents?type=Channel&per=100&page=n` returns the channels a user created. This includes ones owned by a group (`owner.type: "Group"`).
    - Anonymously it returned `public` and `closed` channels. `closed` means anyone can read it but only collaborators can add to it.
  - `GET /v3/users/{id|slug}/groups` returns the groups a user belongs to.
  - `GET /v3/groups/{id|slug}/contents?type=Channel` returns a group's channels, which covers ones other members created.
  - `GET /v3/channels/{id|slug}` returns a channel, with `visibility` and `counts.blocks`.
  - `GET /v3/channels/{id}/contents?per=100&page=n` returns its blocks. Image blocks carry `image.src` (the original) and resized versions, served from `d2w9rnfcy7mm78.cloudfront.net`. lora-trainer already allows that host.
  - Pagination is by page (`meta.next_page`, `meta.total_count`).
  - The anonymous rate limit is 30 requests a minute (`x-ratelimit-tier: guest`).
- **This API:** owns accounts in `dmbk-accounts`. Apps call it server-to-server with the viewer's bearer token.
- **lora-trainer:** `arena.ts` reads a pasted channel URL with `are.na` (v2) plus a v2 fetch for the title. `fal.ts` zips the chosen image URLs for training.

## Goals / Non-Goals

**Goals:**
- Pick from your own public channels, and from public channels in your groups, instead of pasting URLs.
- Move channel reads off v2 into one place (this API).

**Non-Goals:**
- Private channels. If they're ever wanted, see Later.
- Are.na OAuth or any stored Are.na credential.
- Caching. A single user stays well inside 30 a minute.

## Decisions

**A username, not a connection.** Every channel wanted here is readable without auth, so there's nothing to authorize. The account stores its Are.na user's `id` and `slug`. `arenaSetUser` looks the slug up on Are.na first, so a typo fails at save time instead of showing an empty list.

There's no proof that the Are.na account is yours. That's acceptable because everything shown is already public. The username is a convenience filter, not a permission.

**Stored in `dmbk-accounts.arena_profiles`**, one document per account: `{ userId, arenaUserId, arenaSlug, updatedAt }`, with a unique index on `userId`. It's a separate collection rather than a better-auth `additionalFields` column on `user`, so better-auth's schema stays untouched and this can be dropped cleanly. The collection is created by the API with an explicit `createIndex`, since `autoIndex` is off.

**Public and closed only, enforced here.** Every list and channel read drops `visibility: "private"`, whatever Are.na returns. Today the API reads anonymously, so Are.na never returns private channels anyway. The explicit filter keeps that true if a token is ever added for rate limits (see Later).

**`Viewer.arena.channels` merges two sources:**
1. The user's own channels (`users/{id}/contents?type=Channel`).
2. For each of the user's groups (`users/{id}/groups`), the group's channels (`groups/{id}/contents?type=Channel`).

The merge is de-duplicated by channel id and sorted by `updated_at`, newest first. Group fetches run with limited concurrency (4), and a failure in one group drops that group without failing the list.

Pagination: the merged set is built per request (a few calls for one user) and paginated in memory as a Relay connection. Paging Are.na lazily across several sources isn't worth the complexity. If the sources together pass 1,000 channels, the list is cut off at 1,000 and the connection's `truncated` says so.

**Schema.** Are.na isn't one of this API's databases, so these fields take an `arena` prefix in the spirit of `graphql-schema-naming`.
- `arenaSetUser(input: { slug }): { viewer }` and `arenaClearUser: Boolean`. Both need a signed-in viewer (`signedIn` scope, so an anonymous caller gets `FORBIDDEN`).
- `Viewer.arena: ArenaProfile` (nullable) has:
  - `user { id slug name avatarUrl }`
  - `channels(first, after, source: ALL | OWN | GROUPS)`, where `ArenaChannel` has `{ id slug title visibility blockCount updatedAt owner { slug name isGroup } }`
- `arenaChannel(slug: String!): ArenaChannel`, public. Its `images(first, after)` returns `{ id title src thumbnailSrc width height }`, with cursors encoding the Are.na page. A private or missing channel resolves to null.

**Errors.** Are.na 401/403/404 → `NOT_FOUND` from `arenaSetUser`, and null from `arenaChannel`. 429 → `RATE_LIMITED`. Anything else → `UPSTREAM_ERROR`, with detail in the log only.

**lora-trainer reads through this API.** `arena.ts` calls `arenaChannel` server-to-server and drops the `are.na` package, its type shim and the v2 fetch. Pasting a URL keeps working: the slug is taken from the URL and sent to `arenaChannel`. The Train page adds a picker fed by `viewer.arena.channels`. `/auth` adds an "Are.na username" field.

## Risks / Trade-offs

- **The shared guest limit.** The API's server IP shares one 30-a-minute budget. A user in many groups costs `2 + groups` calls to list channels. → That's fine for one user, and 429 returns a clear error. If it ever bites, add a short in-process cache, or read with a personal access token (and keep the private filter).
  - Tested 2026-10-21: an app token from the registered Are.na application's `client_credentials` grant is issued (`scope: read`), but every v3 endpoint answers it with an empty 404, `/v3/ping` included. App tokens can't raise the limit, so they aren't used.
- **The v3 API is new.** → zod-validate the fields used in `src/lib/arena/client.ts`, so a shape change fails loudly in one place.
- **Unverified username.** Anyone can save any Are.na slug. → It only selects public data, and it can matter later only if Are.na is ever used for permissions, which this design doesn't do.

## Later

- **Private channels** would need Are.na OAuth. Are.na allows **one redirect URI per application**, so there are two options:
  - Register one application per environment (production and localhost), each with its app's callback.
  - Put the single callback on this API (`graphql.dmbk.network/arena/callback`), which then hands a one-time ticket back to the app. The app redeems the ticket with the viewer's session, which also blocks linking CSRF.

  The token would be stored encrypted in better-auth's `account` collection (`encryptOAuthTokens`).
