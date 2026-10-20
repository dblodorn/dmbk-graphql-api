# Tasks

Ordered across repos. Every merge to `main` here deploys, so each group is shippable on its own. Never start a group before the one it depends on is deployed.

## 0. Setup (no code)

- [ ] 0.1 In Google Cloud, create or reuse a web OAuth client. Add authorized JavaScript origins: `https://dmbk.io`, the other dmbk apexes, `https://arenatrainer.dmbk.io`, `http://localhost:3000`. Record `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- [x] 0.2 In Atlas, grant the `graphql-api` user `readWrite` on `dmbk-accounts`.
- [x] 0.3 Spike: on the installed better-auth version, confirm how to call Google ID-token sign-in from the server API and how to get the `bearer` session token back. Write the exact calls into design.md.

## 1. API PR — Google accounts, SIWE removed (this repo)

- [x] 1.1 Remove SIWE: delete `src/auth/siwe.ts` and `src/auth/token.ts`, and the `siweNonce`/`signInWithEthereum` mutations. Remove `SiweError` from `src/errors.ts`, and the `viem` and `jsonwebtoken` deps.
- [x] 1.2 `src/env.ts`:
  - Remove `JWT_SECRET`, `ALLOWED_ADDRESSES` and `SIWE_DOMAINS`.
  - Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `ADMIN_EMAILS`, `ACCOUNTS_DB_NAME` (default `dmbk-accounts`) and `ALLOWED_ORIGINS` (host patterns, replacing `SIWE_DOMAINS` as the CORS list).
  - Require the Google and secret variables in production.
  - Parse the email lists like sigil's `allowlist.ts`.
- [x] 1.3 `src/auth/better-auth.ts`:
  - A lazy better-auth instance: Mongo adapter on `dmbk-accounts` via the Mongoose client, the Google provider, the `bearer` plugin.
  - A `user.create.before` hook that refuses unverified email and anything not on `ALLOWED_EMAILS`.
  - `trustedOrigins` taken from `ALLOWED_ORIGINS`.
  - Mount `toNodeHandler` at `/api/auth/*` in `src/index.ts`, ahead of Yoga.
- [x] 1.4 `src/auth/viewer.ts`:
  - `Viewer = { id, email, name, isAdmin }`.
  - An async `getViewerFromRequest` built on `auth.api.getSession({ headers })`. Admission and admin are re-checked on every request, and any failure means anonymous.
  - `src/index.ts` awaits it in the Yoga context.
- [x] 1.5 Schema:
  - `signInWithGoogle(input: { idToken })` returns `{ token, viewer }`. `signOut` returns `{ success }`.
  - `Viewer` exposes `id`, `email`, `name` (nullable) and `isAdmin`. `address` is removed.
  - Map a new `AuthError` (refused sign-in) to `FORBIDDEN` in `src/errors.ts`.
  - The `CLAUDE.md` exempt-from-prefix list gets `signInWithGoogle`/`signOut`.
- [x] 1.6 LoRA ownership:
  - `src/models/lora.ts`: add optional `ownerId`, and make `walletAddress` optional (stored, not exposed).
  - `src/lib/lora/repository.ts`: `isOwner` and the owner filter use `ownerId === viewer.id`.
  - `src/schema/types/lora.ts`: remove the `walletAddress` fields and any `owner`-gated reference to them.
- [x] 1.7 ~~`scripts/ensure-auth-indexes.ts`~~ Not needed: better-auth's Mongo adapter creates its own indexes in `dmbk-accounts`, which only it writes (see design.md, spike).
- [x] 1.8 `scripts/backfill-owner-id.ts`:
  - Report distinct `walletAddress` values with counts in both collections, and how many records are missing `ownerId`.
  - `--map wallet=userId` (repeatable). Refuse while any wallet is unmapped. Dry-run by default, `--apply` to write.
- [x] 1.9 `scripts/test-mutations.ts`:
  - Replace the SIWE sign-in with a `--setup` step that inserts a test user and session directly into the local `dmbk-accounts`, and adds the test email to the local `ALLOWED_EMAILS`/`ADMIN_EMAILS`.
  - Cover owner and non-owner checks with `ownerId` fixtures, plus revoked and anonymous tokens.
- [x] 1.10 Docs:
  - README (mutations, env).
  - CLAUDE.md and AGENTS.md: the env and Auth sections, owner = `ownerId`, the `dmbk-accounts` row in the DB table, and the line saying this API doesn't touch the apps' user collections.
  - The roadmap's Phase 3–4 wording.
- [x] 1.11 `npm run typecheck`. Grep the repo (excluding `node_modules`, `openspec/`) for `siwe|SIWE|ALLOWED_ADDRESSES|jwt|viem`: no matches.
- [ ] 1.12 Set the new env vars on the droplet and remove the old ones. Then merge, deploy, and sign in with Google once to create the owner's user.
- [ ] 1.13 Run the backfill, dry-run first and then `--apply`. Re-run the dry-run: it should report 0 records missing `ownerId`.

## 2. dmbk PR (`dblodorn/dmbk`)

- [ ] 2.1 Google Identity Services button on the admin sign-in. Pass the ID token to `signInWithGoogle`, store the token, and attach it in the tRPC and `/api/graphql` clients.
- [ ] 2.2 `src/server/api/trpc.ts` and `src/server/graphql/context.ts`: resolve the viewer by forwarding `Authorization` to the API's `viewer { id email isAdmin }`, and require `isAdmin` for admin procedures.
- [ ] 2.3 Check `src/app/admin/` for server-side session reads, and move them to the client guard (see design).
- [ ] 2.4 Remove `src/lib/auth.ts`, `auth-client.ts`, `wagmi.ts`, `src/app/api/auth/[...all]`, the wagmi providers and `SignIn.tsx`'s wallet UI. Remove the `better-auth`, `wagmi` and `viem` deps if nothing else imports them, and the `BETTER_AUTH_*` env vars on Vercel.
- [ ] 2.5 Verify on production: sign in, edit a photo, hide or unhide a photo, upload.

## 3. lora-trainer PR (`dblodorn/lora-trainer`)

- [ ] 3.1 The same sign-in, token storage and tRPC-context adapter as 2.1–2.2. `ctx.viewer` replaces `ctx.session.user.walletAddress` everywhere.
- [ ] 3.2 Write `ownerId: viewer.id` on new trainings (`lora.ts#createPendingLora`) and images (`generate.ts`). Owner checks in `lora.ts` compare `ownerId`. Stop writing `walletAddress`. `db.ts` makes it optional and drops the `walletAddress` index in favor of `{ ownerId: 1, hidden: 1 }`.
- [ ] 3.3 Strip crypto:
  - Delete `features/payment.ts` and its router entry, `PaymentGate`, `SignInFlow`, `lib/wagmi.ts`, `lib/auth.ts`, `lib/auth-client.ts` and `pages/api/auth/[...all].ts`.
  - In `fal.ts`, remove `paymentTxHash`, the payment verification and the refunds. In `generate.ts`, remove the rate limit and `remaining`.
  - In `env.ts`, remove the admin wallet, the payment wallet key, the recipient and the QA wallets.
  - Remove the `viem`, `wagmi` and `better-auth` deps, and the env vars on Vercel.
- [ ] 3.4 `npm run typecheck`, then verify on production: sign in, train a LoRA, generate images, hide or unhide. Re-run the backfill (dry-run, then `--apply` if needed) for records written between 1.13 and this deploy.

## 4. Cleanup

- [ ] 4.1 Back up the `user`, `session`, `account`, `verification` and `walletAddress` collections in `dmbk-photos` and `lora-trainer` with `mongodump`, then drop them.
- [ ] 4.2 Remove the old env vars on both Vercel projects.
- [ ] 4.3 Archive this change.
