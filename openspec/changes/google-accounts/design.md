# Design

## Context

- **Three repos, no monorepo.** This API (DigitalOcean droplet, `graphql.dmbk.network`), dmbk (Vercel, `dmbk.io` and other apexes) and lora-trainer (Vercel, `arenatrainer.dmbk.io`). The apps live on different registrable domains from the API, so a cookie set by the API is a third-party cookie to them.
- **Auth today:**
  - Each app runs better-auth with SIWE, using the Mongo adapter on its own database (`user`, `session`, `account`, `verification`, `walletAddress`).
  - This API has its own SIWE flow (`src/auth/siwe.ts`), with nonces held in memory, and issues a 7-day JWT whose `sub` is the wallet.
  - `Viewer` is `{ address, isAdmin }`.
- **Ownership:**
  - LoRA records carry `walletAddress`, and `isOwner` compares it case-insensitively (`src/lib/lora/repository.ts`).
  - Photos have no owner: they're admin-only.
- **lora-trainer payments:** `fal.ts#trainLora` requires a Base ETH tx (`paymentTxHash`) unless `isPaymentExempt(wallet)`, and refunds on fal failure. `generate.ts` limits each wallet to 8 batches a day unless it's exempt.
- **Reference implementation:** `sigil-x-native-interviews/src/lib/auth/` (better-auth with Google, a lazy instance, an allowlist in a `databaseHooks.user.create.before` hook that refuses unverified email, and admission re-checked per request). It relies on cookie sessions on its own domain, which doesn't carry over here.
- **Users:** exactly one person uses either app, and all existing wallets are theirs.

## Goals / Non-Goals

**Goals:**
- One account store, owned by this API, that both apps sign in through with Google.
- No crypto in any of the three repos when this is done: no SIWE, viem, wagmi or payment code.
- At each step every app can still sign in and write. Nothing is left without a working auth path, which is the roadmap's one rule.
- Opening sign-up to everyone later is a config and policy change, not a schema migration.

**Non-Goals:**
- Open sign-up, quotas or payments. The account model leaves room for them (see Decisions), but none are built.
- Moving the apps' data reads and writes onto this API. That's still the roadmap's Phase 4. This change only moves auth.
- Vercel preview sign-in.
- Email/password, magic links or any provider other than Google.

## Decisions

**better-auth inside the API rather than hand-rolled ID-token verification.** A hand-rolled version would be `jose` against Google's JWKS plus a `users` upsert, which is smaller today. better-auth is chosen because it's what sigil and both apps already use, it stores revocable sessions, and it covers the later goals with plugins rather than new code: more providers, account linking, admin roles and Stripe. Build it lazily from the existing Mongoose connection (`mongoose.connection.getClient().db(ACCOUNTS_DB_NAME)`); both use the same `mongodb` 7.7 driver. better-auth's adapter creates its own indexes in `dmbk-accounts`. That doesn't conflict with the global `autoIndex: false`, which exists because other apps own the photo and LoRA databases, so no index script is needed.

**better-auth's HTTP routes are not mounted.** Everything the API needs is a server-side call (`signInSocial`, `getSession`, `signOut`), so `toNodeHandler` isn't used and none of better-auth's other endpoints are reachable. That also makes `trustedOrigins` and CSRF checks moot: the API never sets or reads a cookie, and Yoga's CORS (`ALLOWED_ORIGINS`) is the only browser-facing gate.

**ID-token sign-in, bearer session, exposed as a GraphQL mutation.** The browser gets a Google ID token with Google Identity Services and calls `signInWithGoogle(idToken)`. The resolver calls better-auth's server API (`signInSocial` with `provider: "google"` and `idToken`), which checks the token's audience against `GOOGLE_CLIENT_ID`, and the mutation returns the session token from the `bearer` plugin. Clients send `Authorization: Bearer <token>` exactly as they do now. This avoids redirect flows and third-party cookies, and keeps the clients talking only GraphQL.
- Rejected: OAuth redirects through the API. That needs a cookie on `graphql.dmbk.network` or a one-time-token hand-off.
- Rejected: better-auth in each app. That's the split being removed.
- Spike result (better-auth 1.7.12):
  - `auth.api.signInSocial({ body: { provider: 'google', idToken: { token } }, returnHeaders: true })` verifies the token against Google's JWKS, checking the issuer, the audience (`GOOGLE_CLIENT_ID`) and the signature. It creates or finds the user, which runs `user.create.before`, then creates a session.
  - The `bearer` plugin's after-hook puts the **signed** session token in the `set-auth-token` response header. The body's `token` is the bare session id. With `bearer({ requireSignature: true })` only the signed form is accepted, so the API returns the header value.
  - `auth.api.getSession({ headers })` and `auth.api.signOut({ headers })` with `Authorization: Bearer <signed>` work through the bearer plugin's before-hook.
  - User ids are ObjectId hex strings, which is what `ownerId` stores.

**SIWE is removed outright, not phased out.** No client calls this API yet, so there's no consumer to protect. This API's SIWE code (`src/auth/siwe.ts`, `token.ts`, the JWT, `viem`) goes in the same PR that adds Google sign-in. The apps' own SIWE setups are separate and keep working until each app's PR replaces them.

**Sign-in failures are all one generic error.** Bad token, wrong audience, unverified email or not on the list: each returns `AuthError('Sign-in failed.')` with code `UNAUTHENTICATED`, as SIWE did, so a caller can't probe which check failed. The server log says which.

**Context resolves the session per request.** `getViewerFromRequest` becomes async: `auth.api.getSession({ headers })`. Any failure means anonymous, never an error, as today. `isAdmin` is `ADMIN_EMAILS.has(email)` on every request and is never stored. That costs one indexed session lookup per request, which is fine for a single PM2 process. Add a short in-process cache only if it shows up in latency.

**Two allowlists, sigil's parsing.**
- `ALLOWED_EMAILS` gates account creation in the `user.create.before` hook. An unverified email is refused first. An empty or unset list admits nobody and logs loudly at startup.
- `ADMIN_EMAILS` grants admin.
- Today both hold the one owner's address.
- Opening sign-up later means removing the creation gate (or adding a waitlist). Admin is unaffected.
- Someone removed from `ALLOWED_EMAILS` still has a user row, so the per-request check also requires the email to be allowed. Removal therefore takes effect at the next request, as in sigil's D7.

**Ownership is `ownerId`, migrated by expand → backfill → contract.**
- **In this API:** `ownerId` is optional on both LoRA models, and `isOwner` and the owner filter match only `ownerId === viewer.id`. `walletAddress` stays in the model as a stored field but isn't exposed. A record without an `ownerId` has no owner here, which is harmless while no client uses this API.
- **Backfill:** `scripts/backfill-owner-id.ts` lists distinct `walletAddress` values with counts, takes an explicit `--map wallet=userId` for each one (the owner signs in with Google once first, to create their user), and refuses to run while any wallet is unmapped. It's a dry run by default. It's safe to re-run: run it right after deploying, and again after the lora-trainer PR, to catch records lora-trainer wrote in between with only `walletAddress`.

**The apps authenticate through this API before their data moves.** Their tRPC routers still read and write Mongo until Phase 4, but their auth changes now:
- Each app's `protectedProcedure` forwards the incoming `Authorization` header to this API's `viewer { id email isAdmin }` and uses the result.
- lora-trainer writes `ownerId: viewer.id` on new records.
- That adapter is deleted along with tRPC in Phase 4.
- It's chosen over keeping better-auth in the apps temporarily because it lets all of the apps' auth code go now, and it's one small file per app.
- The client stores the token in `localStorage` and attaches it in the tRPC and GraphQL clients.
- Check while building: any server-rendered page in dmbk's admin that reads the better-auth session needs moving to a client guard or a cookie the app sets from the token. Verify against `src/app/admin/`.

**Crypto removal in lora-trainer is a deletion, not a replacement.**
- `trainLora` no longer takes `paymentTxHash`, and `generate` drops the rate limit: the only user is the admin, who was exempt anyway.
- Delete `payment.ts`, `PaymentGate`, `lib/wagmi.ts`, `SignInFlow`, and the env vars `getAdminWallet`, the payment wallet key, the payment recipient and the QA wallets.
- Future payments get their own change (better-auth Stripe plugin or similar), keyed on `ownerId`.


## Risks / Trade-offs

- **Locked out by misconfiguration.** An empty `ALLOWED_EMAILS`, a wrong `GOOGLE_CLIENT_ID`, or an origin missing from the Google console means nobody can sign in. Mitigation: startup logs name the missing variable (sigil's pattern), and sign-in is checked on the deployed API before either app's PR starts. While that's being fixed, the apps keep their own SIWE sign-in, so nothing is locked out.
- **The token in `localStorage` is readable by any XSS** on the app origin. That's the same exposure as today's JWT. It's accepted for now, and a per-app httpOnly cookie relay can come later if open sign-up raises the stakes.
- **One session lookup per API request.** A single process and an indexed `token` make this negligible. Revisit with horizontal scaling, which is already an open roadmap question.
- **Dropping the apps' auth collections is irreversible.** Do it last, after a `mongodump` of those collections.

## Open Questions

- Should `loraWeightsUrl` become owner-only now that ownership changes? It's carried over from the roadmap and doesn't block this change.
