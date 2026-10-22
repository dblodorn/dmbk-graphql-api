# Tasks

## 1. Config and keys

- [x] 1.1 Add `API_KEYS_ENFORCED` (true only for the literal `true`), `HOST` (default `127.0.0.1` when `NODE_ENV=production`, else `0.0.0.0`), `PLAYGROUND_RATE_LIMIT` (30), `PLAYGROUND_RATE_WINDOW_SECONDS` (60), `PLAYGROUND_MAX_DEPTH` (10) and `PLAYGROUND_MAX_ROOT_FIELDS` (5) to `src/env.ts`. Pass `env.host` to `server.listen` in `index.ts`. Verify: `npm run typecheck` passes, and `npm run dev` logs the bound host.
- [x] 1.2 Create `src/lib/api-keys/` with key generation (`dmbk_` + 32 random bytes in base64url, plus the key id), SHA-256 hashing, and access to `dmbk-accounts.api_clients` through the native driver: `findActive(key)`, `create`, `list`, `revoke`, the throttled `lastUsedAt` touch, and an `ensureIndexes` for `{ client: 1 }`. Verify: typecheck passes, and a scratch call creates a key, finds it by hash, and stops finding it after revoke.
- [x] 1.3 Write `scripts/api-clients.ts` and the `api-client` npm script: `create <client>` (validate kebab-case; print the key and key id once), `list` (client, key id, created, last used, revoked; never the hash), and `revoke <client> [--key <keyId>]`. Verify: run all three against the local DB. `list` shows no key or hash, and `db.api_clients` holds only hashes.

## 2. Request classification and rate limit

- [x] 2.1 Write the token-bucket limiter (`src/lib/api-access/rate-limit.ts`): per-IP buckets with an even refill, a `take(ip)` that returns `{ ok } | { retryAfterSeconds }`, and a sweep each window that drops full buckets. Verify: a scratch run with limit 3 / 10 s allows 3, refuses the 4th with a positive `retryAfterSeconds`, and allows again after the refill.
- [x] 2.2 Write `clientIp(request, serverContext)`. It trusts the rightmost `X-Forwarded-For` entry only when the socket peer is loopback; otherwise it uses the socket address. Verify: with the dev server, `curl -H 'X-Forwarded-For: 1.2.3.4' localhost:4000/...` is keyed as `1.2.3.4` (loopback peer). A spoofed multi-entry header is keyed by its last entry.
- [x] 2.3 Write the Yoga plugin's `onRequest` (`src/lib/api-access/plugin.ts`):
  - let `OPTIONS` through;
  - classify by `X-API-Key` into client, playground or legacy;
  - refuse an unknown or revoked key with 401 + `UNAUTHENTICATED` and one fixed message;
  - answer 503 + `UPSTREAM_ERROR` when the lookup throws;
  - rate-limit playground requests with 429 + `Retry-After` + `RATE_LIMITED`;
  - store the result in a `WeakMap<Request, Access>`.

  Never log or echo the key. Verify: curl with a bogus key gets 401 and the key doesn't appear in the server log. With the flag on and limit 2, a third keyless request gets 429 with `Retry-After`.
- [x] 2.4 Add the keyless-request log for the legacy (flag off) path: `[api-access] keyless request` with IP, `Origin` and `User-Agent`, deduplicated per `(ip, origin, ua)` per hour. Verify: two identical keyless curls with the flag off produce one log line.
- [x] 2.5 Wire the context: the context factory in `index.ts` reads the classification. For playground it skips `getViewerFromRequest`, so the viewer is null. Add `client: string | null` to `ContextType`. Verify: with the flag on, a keyless request carrying a valid admin bearer gets `viewer: null`. The same request with a client key gets the admin viewer.

## 3. Playground validation

- [x] 3.1 Write the three validation rules (`src/lib/api-access/rules.ts`):
  - non-`query` operation → `FORBIDDEN`;
  - selection depth over `PLAYGROUND_MAX_DEPTH` → `BAD_USER_INPUT`, with introspection fields not counted;
  - root fields after alias expansion over `PLAYGROUND_MAX_ROOT_FIELDS` → `BAD_USER_INPUT`.

  Verify: typecheck passes, and each rule refuses its case in task 3.2's checks.
- [x] 3.2 Add the rules in `onValidate` for playground requests only, so they run even when Yoga has the document cached as valid. Verify these against the dev server with the flag on:
  - a keyless mutation (including `signInWithGoogle`) gets `FORBIDDEN`;
  - a deep query and a 6-alias query get `BAD_USER_INPUT`;
  - GraphiQL loads without a key and renders the docs (introspection passes);
  - the same deep query first sent with a client key, then without one, is refused the second time.
- [x] 3.3 Set the CORS allowed headers to `content-type, authorization` in `index.ts`. Verify: a preflight with `Access-Control-Request-Headers: x-api-key` from an allowed origin gets no `x-api-key` in `Access-Control-Allow-Headers`. A normal allowed-origin request still passes.

## 4. Errors and tests

- [x] 4.1 Make sure every refusal the plugin builds goes out with exactly the spec's codes (`UNAUTHENTICATED`, `RATE_LIMITED`, `FORBIDDEN`, `BAD_USER_INPUT`, `UPSTREAM_ERROR`) and isn't masked by `maskError` as "Unexpected error". Add any new domain error class to the `CODES` table in `errors.ts`. Verify: each refusal from tasks 2.3 and 3.2 shows its code in `extensions.code` with `NODE_ENV=production`.
- [x] 4.2 Update `scripts/test-mutations.ts`:
  - insert a `test-mutations` key into `api_clients` at start, send it on every request, and delete it at the end;
  - make `--cleanup` remove a leftover key;
  - document starting the server with `API_KEYS_ENFORCED=true`.

  Verify: `npm run test:mutations` passes end to end, and `api_clients` holds no `test-mutations` key afterwards.
- [x] 4.3 Add a playground suite to `scripts/test-mutations.ts` covering each scenario in the spec: keyless public read, keyless mutation, session ignored, depth, root fields, bad key, revoked key (same message as an unknown key), introspection, and the rate limit (server started with a small `PLAYGROUND_RATE_LIMIT`). Verify: the suite passes, and fails if any one rule is temporarily disabled.
- [x] 4.4 Check the deploy health check: the keyless `_health` POST in `.github/workflows/deploy.yml` succeeds with the flag on and the server bound to `127.0.0.1`. Verify: run the workflow's curl locally with `HOST=127.0.0.1 API_KEYS_ENFORCED=true` and get a 0 exit code.

## 5. Docs

- [x] 5.1 Update `CLAUDE.md`:
  - list the new env vars in the env section;
  - add an "API access" paragraph to Architecture (keys, playground tier, flag, IP via Caddy, `127.0.0.1` binding);
  - add `npm run api-client` to Commands;
  - add `api_clients` to the `dmbk-accounts` row of the DB table.

  Verify: the doc names every new env var and script.
- [x] 5.2 Add the client-key rollout to `docs/plans/2026-10-08-migration-roadmap.md` as checkboxes mirroring section 6. Verify: the roadmap lists each client and the enforcement step.

## 6. Rollout (API repo + clients)

- [x] 6.1 Before deploying, run `ss -ltnp` on the droplet and confirm nothing besides Caddy and loopback reaches `:4000`. Merge to `main` with `API_KEYS_ENFORCED` unset. Verify: the deploy job passes, the GraphQL endpoint answers through Caddy, and `curl http://<droplet-ip>:4000/graphql` is refused.
- [x] 6.2 Issue production keys (`npm run api-client -- create dmbk-photo`, then `lora-trainer`, then `dmbk`) and set `DMBK_GRAPHQL_API_KEY` in each Vercel project (Production, Preview, Development). Verify: `npm run api-client -- list` shows three active clients with no `lastUsedAt` yet.
- [x] 6.3 dmbk-photo:
  - send `x-api-key` from `src/server/auth/session.ts` `callApi` and from the server path of `lib/dmbk-api.ts`;
  - add a same-origin `GET /api/photos` read route and point `usePhotoPages` and `gallery-api.ts` at it;
  - fail loudly in production when the key is missing.

  Verify: the gallery paginates and filters in the browser with no request to graphql.dmbk.network in the network tab, and the admin still works.
- [x] 6.4 lora-trainer: send `x-api-key` from `src/server/auth/session.ts` and fail loudly when it's missing. Verify: sign-in, trainings and images work on a preview deploy, and its `lastUsedAt` updates.
- [x] 6.5 dmbk: send `x-api-key` from the `/sound` fallback request and fail loudly when it's missing. Verify: `/sound` renders from the API fallback, and `dmbk`'s `lastUsedAt` updates.
- [x] 6.6 Watch `pm2 logs graphql-api | grep '\[api-access\] keyless'` for at least a day after the client deploys. Verify: only expected keyless traffic remains (health check, deliberate GraphiQL use).
- [x] 6.7 Set `API_KEYS_ENFORCED=true` in the droplet `.env` and run `pm2 restart graphql-api --update-env`. Verify:
  - all three apps work in production;
  - a keyless mutation from curl gets `FORBIDDEN`;
  - a burst of 31 keyless requests gets a 429.
