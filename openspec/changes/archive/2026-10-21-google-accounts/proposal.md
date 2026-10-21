# Proposal

## Why

This API is becoming the data layer for dmbk and lora-trainer (see `docs/plans/2026-10-08-migration-roadmap.md`), but identity is still split three ways. Each app runs its own better-auth with SIWE and keeps its own `user`/`session` collections, and this API issues its own SIWE JWT on top. Ownership of LoRA records is a wallet address, and lora-trainer's training payments and rate limits are tied to that wallet.

Wallets aren't wanted as identity any more, and the crypto payment path is being removed. Today there is one user (the owner of both apps), so this is the cheapest time to replace the account model: there are no other users to migrate or notify. Phase 4 of the roadmap would move both apps' admin sign-in onto the SIWE token. Doing this first means the clients move once, onto the final auth.

The model should also be ready for a later move to open sign-up and non-crypto payments, without opening either now.

## What Changes

- **New**: this API owns accounts. better-auth runs inside the API with the MongoDB adapter, the Google provider and the `bearer` plugin, storing users, accounts and sessions in a new database, `dmbk-accounts`.
- **New**: `signInWithGoogle(input: { idToken })` returns `{ token, viewer }`. The client gets the ID token from Google Identity Services. `signOut` revokes the session. Sessions are stored in the database and can be revoked, unlike the current 7-day JWT.
- **New**: Sign-in is gated by `ALLOWED_EMAILS` (sigil-x-native-interviews' allowlist pattern: an empty list admits nobody, unverified emails are refused). Admin is `ADMIN_EMAILS`, checked on every request.
- **New**: LoRA records get `ownerId` (the account's user id). A one-off script backfills it on every existing training and image.
- **BREAKING** `Viewer` becomes `{ id, email, name, isAdmin }`. `viewer.address` is removed.
- **BREAKING** `siweNonce`, `signInWithEthereum`, the JWT, `ALLOWED_ADDRESSES`, `SIWE_DOMAINS` and `viem` are removed in the same PR. No app has connected to this API yet, so there's nothing to keep working during a transition. CORS moves to `ALLOWED_ORIGINS`.
- **BREAKING** `LoraTraining.walletAddress` and `GeneratedImage.walletAddress` are no longer exposed. The stored field is kept and is no longer written.
- **Cross-repo, tracked here**:
  - dmbk and lora-trainer replace their better-auth/SIWE/wagmi setup with Google sign-in through this API.
  - lora-trainer removes on-chain payments, refunds, payment exemption and the wallet-keyed rate limit.
  - The apps' old auth collections are dropped at the end.

## Capabilities

### New Capabilities
- `accounts-auth`: Google sign-in, sessions, the sign-in allowlist and admin rule, the `Viewer` shape, and record ownership by account.

### Modified Capabilities
<!-- None: graphql-schema-naming is unaffected. signInWithGoogle and signOut are cross-cutting, so they take no database prefix. -->

## Impact

- **This repo:**
  - `src/auth/` is replaced, and `src/env.ts`, `src/context.ts` and `src/index.ts` change: better-auth is mounted next to Yoga.
  - Also affected: `src/models/lora.ts`, `src/lib/lora/repository.ts`, `src/schema/types/viewer.ts`, `src/schema/mutations.ts` and `src/errors.ts`.
  - `scripts/test-mutations.ts`'s sign-in moves to a test session.
  - Docs to update: README, CLAUDE.md, AGENTS.md and the roadmap.
- **Atlas:** the `graphql-api` user needs `readWrite` on `dmbk-accounts`.
- **Google Cloud:** one OAuth client, with an authorized JavaScript origin for each app host. Wildcards aren't allowed, so Vercel previews still can't sign in (an open item already).
- **dmbk** (`dblodorn/dmbk`):
  - Remove `src/lib/auth.ts`, `auth-client.ts`, `wagmi.ts`, `/api/auth` and the wagmi providers.
  - Admin sign-in and the tRPC/GraphQL contexts authenticate through this API.
- **lora-trainer** (`dblodorn/lora-trainer`):
  - The same auth swap as dmbk.
  - Remove `features/payment.ts`, `PaymentGate`, the payment and refund code in `fal.ts`, the rate limit in `generate.ts`, and the wallet env vars.
  - New records are written with `ownerId`.
- **Deployment:** every merge here deploys. The API change ships as one PR. The apps' own SIWE setups keep working on their side until their PRs land, because they don't depend on this API yet.
