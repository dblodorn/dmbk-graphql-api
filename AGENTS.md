# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # tsx watch --env-file=.env src/index.ts — GraphiQL at http://localhost:4000/graphql
npm run start      # same, no watch
npm run typecheck  # tsc --noEmit
npm run build      # also just tsc — tsconfig has noEmit: true, so nothing is emitted
```

- No test suite and no linter; `npm run typecheck` is the only automated check.
- Code always runs through `tsx` (dev, start, and PM2 via `ecosystem.config.cjs`); there is no compiled output. Prod runs `npm install --omit=dev` and then `npx tsx`, so `tsx` is a devDependency prod needs at runtime.
- `dev`/`start` load `.env` via `--env-file` (Node errors if the file is missing); PM2 loads it via `env_file`.
- Env (`src/env.ts`, validated at startup): `MONGODB_URI`, `DO_SPACES_CDN_URL` (required); `JWT_SECRET` (required in production); `ALLOWED_ADDRESSES` (comma-separated admin wallets); `SIWE_DOMAINS` (comma-separated hosts users sign in *from*, e.g. `dmbk.io,localhost:3000`); `PHOTOS_DB_NAME` / `LORA_DB_NAME` (default `dmbk-photos` / `lora-trainer`); `PORT`; `NODE_ENV`.

## Deployment

**Every push to `main` deploys to production.** `.github/workflows/deploy.yml` SSHes into a DigitalOcean droplet, `git pull`s `/opt/graphql-api`, runs `npm install --omit=dev`, and `pm2 restart graphql-api`. There is no typecheck gate in CI — run `npm run typecheck` before pushing. Caddy terminates TLS for `graphql.dmbk.network` and proxies to port 4000.

## What this is

A Relay GraphQL API (Pothos + Yoga + Mongoose) over data **owned by two other apps** on the same Atlas cluster (`dmbk-world`):

| DB | Collections served | Owning app |
|---|---|---|
| `dmbk-photos` | `photos`, `keywords`, `sound_snapshots` | `dblodorn/dmbk` (Next.js; `src/server/api/db.ts` there is the schema source of truth) |
| `lora-trainer` | `lora_trainings`, `generated_images` | `dblodorn/lora-trainer` |

Both apps still read/write these collections directly (tRPC). The plan is to move their clients onto this API and retire their own endpoints — dmbk's `/api/graphql` (`src/server/graphql/`) and the tRPC routers — **one capability at a time, only once the replacement here is live**. The `user`/`session`/`account`/`verification`/`walletAddress` collections in both DBs belong to those apps' better-auth setups; this API does not touch them.

## Architecture

ESM (`"type": "module"`, `NodeNext`): relative imports need `.js` extensions in `.ts` files.

**Layers.** `models/` (Mongoose schemas) → `lib/*/repository.ts` (every query and write; all visibility rules) → `schema/` (Pothos types and resolvers, thin). Resolvers never build Mongo filters themselves.

**Models mirror foreign documents exactly.** String `_id`s (UUIDs for photos, hex for LoRA records), ISO-8601 *strings* for dates, explicit `collection` names, `versionKey: false`, no Mongoose timestamps. `autoIndex`/`autoCreate` are off globally (`db/mongoose.ts`) because the owning apps manage indexes — never enable them. Both DBs share one connection via `useDb(..., { useCache: true })`.

**Visibility lives in the repositories, and the per-request loaders in `context.ts` are pre-scoped to the viewer.** Node lookups (`node(id)`) and nested fields load through those loaders, so a record the viewer may not see resolves to `null` — indistinguishable from nonexistent.
- Photos: public = `status: "ready"` and `hidden: false` (`PUBLIC_SCOPE`); admins (`ALLOWED_ADDRESSES`) see everything. `photos(visibility, states)` with non-default values is *refused* for non-admins, not silently narrowed. `originalKey` is never exposed; URLs are `DO_SPACES_CDN_URL` + derivative key.
- LoRA: public trainings = `completed` and `hidden ≠ true`; public images = `hidden ≠ true`. Owner = the record's own `walletAddress` (case-insensitive); an image's owner is whoever generated it, not the LoRA's trainer. `hidden` uses `$ne: true` because lora-trainer never backfilled it.
- Privileged fields (`Photo.hidden/status/failureReason`, owner-only `walletAddress/hidden/trainingZipUrl`) use scope-auth with `unauthorizedResolver: () => null` — they resolve to null rather than erroring, so one fragment serves public and admin views.

**Keyword counts are shared state.** `lib/photos/keywords.ts` and the `isCounted` rule in `lib/photos/repository.ts` are ported verbatim from dmbk (`src/lib/photos/keywords.ts`, `repository.ts`). While both apps write, any change to normalization or count maintenance must be made in both repos.

**Auth.** SIWE handled here (`auth/siwe.ts`): `siweNonce` → wallet signs EIP-4361 message → `signInWithEthereum` returns a 7-day JWT sent as `Authorization: Bearer`. Nonces are in process memory (correct for the single PM2 process only). The message `domain` must be in `SIWE_DOMAINS`; EOA signatures only (no ERC-1271). `isAdmin` is derived from `ALLOWED_ADDRESSES` on every request, never stored in the token. Scopes: `signedIn`, `admin`.

**Relay.** `Photo`, `LoraTraining`, `GeneratedImage` are `Node`s with Pothos global IDs (base64 `Type:id`). Connections are keyset-paginated on `(createdAt, _id)` newest-first (`lib/cursor.ts`, same cursor encoding as dmbk); forward-only — `last`/`before` are refused. Fields are non-null by default (`builder.ts`); opt into `nullable: true` where a value can be absent. Mutations are `relayMutationField`s (single `input`, payload with the changed node); they return the repository's result, not a loader read, since the loader may hold a pre-mutation copy.

**Schema registration is by side effect**: `index.ts` imports `schema/queries.js` and `schema/mutations.js`, which import the type modules, before `builder.toSchema()`. A new schema file must be reachable from those imports.

**Errors.** Repositories throw domain errors (`InvalidInputError`, `*NotFoundError`, `ForbiddenError`, `SiweError`); `errors.ts#maskError` maps them to GraphQL `extensions.code`s and masks everything else. Add new domain error classes to its `CODES` table or they surface as "Unexpected error."

## Roadmap

Phased plan, open items and the source files to port live in `docs/plans/2026-10-08-migration-roadmap.md`. Read it before starting on uploads/delete (Phase 2), LoRA training/generation (Phase 3), or moving the dmbk / lora-trainer clients over (Phase 4), and tick off its checkboxes as work lands.
