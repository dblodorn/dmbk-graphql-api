# Design

## Context

Motivation and scope are in `proposal.md`; the behaviour contract is `specs/api-access/spec.md`.

Constraints from the current code:

- Yoga runs on Node's `http.createServer`, in one PM2 process on a 2 GB droplet. Caddy terminates TLS and proxies to `:4000`. PM2 sets only `PORT`, so the server listens on every interface.
- The context factory (`index.ts` → `createContext`) resolves the viewer from `Authorization: Bearer` for every request. Visibility follows from the viewer and nothing else.
- `dmbk-accounts` is this API's own database. `arena_profiles` sets the precedent: a module that owns a collection there creates that collection's index itself.
- `errors.ts#maskError` maps domain errors to codes. A `GraphQLError` thrown deliberately passes through unchanged.
- The deploy health check POSTs a keyless `_health` query to `localhost:4000`.
- All three clients already call the API from their servers through one helper each (`callApi` / `post`). The exception is dmbk-photo's gallery, whose browser fetches later pages.

## Goals / Non-Goals

**Goals:**
- Keys are checked before any resolver, parse result or loader exists, so a request without a valid key never reaches anything visible to the viewer.
- No new runtime dependency: the depth, alias and operation-type rules and the rate limiter are small and local.
- Revocation takes effect on the next request, with no in-process cache to invalidate.

**Non-Goals:**
- Per-client rate limits or quotas. Clients are trusted apps; only the playground is limited.
- Scoping keys to parts of the schema. A key identifies an app, and session scopes still decide what a person may do.
- Persisted operations or an operation allowlist on the API side. dmbk-photo's admin proxy already does that for its own token.
- A shared or distributed limiter (Redis and similar). There is one process.
- Changes to Caddy beyond what is noted under Migration.

## Decisions

### 1. Key format and storage

A key is `dmbk_` + 32 random bytes in base64url (43 chars). Its first 8 characters after the prefix are its **key id**, which is safe to show in listings and to pass to `revoke`. The prefix makes a leaked key easy to spot in a log or a secret scanner.

Keys are stored in `dmbk-accounts.api_clients`, one document per key:

```
{ _id: <sha256(key) hex>, keyId, client, createdAt, revokedAt: null | ISO, lastUsedAt: null | ISO }
```

- **Plain SHA-256 instead of bcrypt or argon2.** The key has 256 bits of entropy, so there is nothing for slow hashing to protect against brute force. A fast hash also lets the lookup be a single `_id` point read: hash the presented key, then `findOne({ _id, revokedAt: null })`. No key is ever compared in user code, so there is no timing channel to worry about.
- **The hash as `_id`:** it is unique for free and needs no extra index. A secondary index on `{ client: 1 }` serves the script's listings; `lib/api-keys/` creates it, as `arena_profiles` does.
- **Collection, not env var:** clients will be added. A collection means issuing or revoking a key needs no redeploy and no PM2 restart, which the spec requires. Env-var keys were rejected because every change would mean editing the droplet's `.env` and restarting.
- **Accessed through the native driver** on the shared Mongoose connection, as `arena_profiles` is, not through a Mongoose model. This collection belongs to us, not to a foreign app, so mirroring a foreign document shape doesn't apply.

`lastUsedAt` is written only when the stored value is more than an hour old. This keeps the "is this key still in use" signal without a write on every request.

### 2. One Yoga plugin, three hooks

`src/lib/api-access/plugin.ts` exports a Yoga plugin registered in `index.ts`:

- **`onRequest`** (async, before the body is parsed):
  1. `OPTIONS` requests pass through to CORS.
  2. Classify by `X-API-Key`. An unknown key ends the request at once: HTTP 401 with `{ errors: [{ message: 'Invalid API key.', extensions: { code: 'UNAUTHENTICATED' } }] }`.
  3. If the request is playground and enforcement is on, take a token from the IP's bucket. An empty bucket ends the request with 429, `Retry-After` and `RATE_LIMITED`.
  4. Record the classification `{ kind: 'client', client } | { kind: 'playground' } | { kind: 'legacy' }` in a `WeakMap<Request, Access>`. `legacy` means keyless with the flag off.
- **The context factory** reads that classification. For `playground`, it skips `getViewerFromRequest` entirely, so the viewer is null and the loaders are public-scoped. Skipping the lookup also saves a database round trip on every playground request. `ContextType` gains `client: string | null` for logs.
- **`onValidate`**: for `playground` only, it adds three validation rules, which run before execution:
  - `operation !== 'query'` → `FORBIDDEN`
  - selection depth > `PLAYGROUND_MAX_DEPTH` → `BAD_USER_INPUT`
  - more root fields than `PLAYGROUND_MAX_ROOT_FIELDS`, counted after aliases are expanded → `BAD_USER_INPUT`

  Introspection fields (`__schema`, `__type`) don't count toward depth, so GraphiQL's introspection query passes.

**Why `onRequest` for the key and the rate limit:** a refusal there costs no parse or validation, and it is the only place that can set the HTTP status and `Retry-After`. **Why validation rules for the rest:** they need the parsed document, and validation already exists to refuse a document before execution. Rejected alternative: `@escape.tech/graphql-armor`. It applies to every request, while our limits are per tier, and it adds a dependency for about 60 lines of rules.

Yoga caches validation results per document, but its cache is also keyed by the names of the validation rules in effect (`useParserAndValidationCache`, which runs after user plugins). The playground rules are added with `addValidationRule`, and each has a stable, distinct function name. Playground and keyed results therefore sit under different cache keys and never stand in for each other, with no bypass needed. Because a rule list that isn't set would *replace* graphql's standard rules, the plugin adds `specifiedRules` first when `params.rules` is unset.

### 3. Rate limiter

A token bucket per IP in a `Map<string, { tokens, updatedAt }>`. Capacity is `PLAYGROUND_RATE_LIMIT` (default **30**), refilled evenly over `PLAYGROUND_RATE_WINDOW_SECONDS` (default **60**). Refilling evenly lets someone using GraphiQL work steadily, instead of getting 30 requests at the top of each minute and then nothing. A sweep every window drops full buckets, so memory is bounded by the number of active IPs.

The GraphiQL HTML page doesn't count: Yoga's GraphiQL plugin serves it before user plugins see the request.

### 4. Client IP behind Caddy

Caddy's `reverse_proxy` adds the client address to `X-Forwarded-For`. The plugin trusts that header only when the socket peer (`serverContext.req.socket.remoteAddress`) is loopback, and then takes the **rightmost** entry, which is the one Caddy added. Any other peer is keyed by its socket address. In production the server binds to `127.0.0.1` (`HOST`, default `127.0.0.1` when `NODE_ENV=production`), so `:4000` can't be reached directly and the header can't be spoofed by skipping Caddy. The deploy health check already uses `localhost`.

### 5. Enforcement flag

`API_KEYS_ENFORCED` is true only when it equals `true`. When it is off, keyless requests are `legacy` and behave exactly as today. Each one is logged as `[api-access] keyless request` with its IP, `Origin` and `User-Agent`, deduplicated per `(ip, origin, user-agent)` once an hour, so the log shows who still needs a key without being flooded. An unknown key is refused in either mode (spec).

### 6. Failure of the key lookup

If the `api_clients` read fails, for example because Atlas can't be reached, the request ends with 503 and `UPSTREAM_ERROR`. It fails closed: it is never downgraded to playground or legacy. With Atlas down, no resolver would work anyway.

### 7. Operator script

`scripts/api-clients.ts`, run as `npm run api-client -- <cmd>`:

- `create <client>`: prints the key once, along with its key id.
- `list`: shows client, key id, created, last used and revoked. Never the hash.
- `revoke <client> [--key <keyId>]`: without `--key`, revokes every active key of that client.

Rotation is `create`, deploying the new key to the client, then `revoke --key <old>`. Client names are kebab-case and are what logs show.

### 8. CORS

The allowed request headers are set explicitly to `content-type, authorization`. `X-API-Key` is left out on purpose: a browser preflight that asks for it fails. This backs up "browsers never hold a key", because a key pasted into browser code doesn't work across origins. GraphiQL is same-origin and needs no preflight, so its headers panel can still send a key.

### 9. Clients

Each client reads `DMBK_GRAPHQL_API_KEY`, a server-only variable that is never prefixed `NEXT_PUBLIC_`, and adds `x-api-key` in its one server-side caller:
- dmbk-photo: `src/server/auth/session.ts` `callApi`, which the admin Relay proxy also uses, and the server path of `lib/dmbk-api.ts`.
- lora-trainer: `src/server/auth/session.ts`.
- dmbk: the `/sound` fallback request.

A future Relay environment does the same thing in its `fetchFn`, on the server or behind a same-origin route. dmbk-photo's gallery gets a same-origin `GET /api/photos` read route. The browser calls that route, and it forwards to the API with the key. Each client must refuse to start, or fail the request, when the variable is missing in production, so a deploy without a key doesn't silently fall to the playground.

### 10. Tests

`scripts/test-mutations.ts` writes a `test-mutations` key straight into `api_clients` at start and deletes it at the end, as it does with its `.invalid` test accounts. `--cleanup` removes a key left behind by a crashed run. The local server runs with `API_KEYS_ENFORCED=true`. A new playground suite covers each scenario in the spec: keyless read, keyless mutation, session ignored, depth, root fields, bad key, revoked key, and the rate limit with a small limit set through env.

## Risks / Trade-offs

- **A database read on every keyed request** adds one `_id` point read on Atlas, about 1–5 ms. → This is acceptable next to resolver reads. If it shows up in latency, add a positive-only cache of about 30 s and relax the spec's "next request" to "within 30 s". That would be a spec change, not done silently.
- **Rate-limit state is lost on restart, and deploys restart.** → For a playground that is acceptable. The limit slows abuse; it isn't an accounting system.
- **Many users behind one NAT share a bucket.** → Acceptable: real users go through client apps, which aren't limited.
- **Yoga's validation cache could let a client-validated document skip the playground rules.** → Decision 2: the cache is keyed by rule names, so the two tiers are cached separately. A test sends the same deep query with a key, then without one, then with one again.
- **Binding to `127.0.0.1` breaks anything that reaches `:4000` from outside the droplet.** → Nothing should: Caddy and the health check use loopback. Check the droplet with `ss -ltnp` before deploying.
- **A client deployed without its key falls to the playground** while enforcement is on. → Decision 9: clients fail loudly when the key is missing. Keyless logging during the flag-off period also shows such a client before the flag is turned on.
- **A leaked key gives full client access** until it is revoked. → Keys live only in server env (Vercel and the droplet), the `dmbk_` prefix helps secret scanning, and revocation is one command with no redeploy.

## Migration Plan

1. Ship the API change with `API_KEYS_ENFORCED` unset. Behaviour is unchanged except that bad keys are refused and keyless requests are logged. Confirm `HOST` binding and the health check after the deploy.
2. `npm run api-client -- create dmbk-photo` (and `lora-trainer`, `dmbk`). Set `DMBK_GRAPHQL_API_KEY` in each Vercel project for Production, Preview and Development, or in local `.env` files.
3. Land the client changes: send the key, and add dmbk-photo's gallery read route. Deploy them.
4. Watch `[api-access] keyless request` on the droplet (`pm2 logs`) until only expected traffic remains: health checks, any playground use.
5. Set `API_KEYS_ENFORCED=true` in the droplet's `.env` and run `pm2 restart graphql-api --update-env`.
6. **Rollback:** unset the flag and restart. Keys stay valid, so clients are unaffected either way. Reverting the API change entirely is safe because clients ignore a header the API doesn't read.

## Open Questions

- Final playground defaults (30 requests a minute, depth 10, 5 root fields). They are env-tunable and can be adjusted after watching real GraphiQL use, with no change to the spec or the tasks.
