# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # tsx watch --env-file=.env src/index.ts — GraphiQL at http://localhost:4000/graphql
npm run start      # same, no watch
npm run typecheck  # tsc --noEmit
npm run build      # also just tsc — tsconfig has noEmit: true, so nothing is emitted
npm run test:mutations  # end-to-end mutation checks against a running local server (see below)
```

- No unit tests and no linter; `npm run typecheck` (covers `src/` and `scripts/`) is the only automated check. It runs as a pre-commit hook (`.githooks/pre-commit`, wired up by the `prepare` script on `npm install`) and as the `typecheck` CI job on every PR and before every deploy.
- `scripts/test-mutations.ts` exercises auth and every mutation against **live data** through a local server, restoring all it changes. Google ID tokens can't be scripted, so it creates `.invalid` test accounts and sessions directly in `dmbk-accounts` and deletes them afterwards. Run `-- --setup` once: it adds those emails to the *local* `ALLOWED_EMAILS` / `ADMIN_EMAILS` — never add them to production's. `-- --cleanup` removes fixtures and test accounts left by a crashed run.
- `npm run move:sound-snapshots` copies the SoundCloud snapshot from `dmbk-photos` into `dmbk-sound` (`-- --apply`), then `-- --drop-source` drops the old collection once the copy is at least as new. Report-only by default, never regresses a newer copy, safe to re-run.
- `npm run backfill:owner-id` fills `ownerId` on LoRA records from their old `walletAddress` (`-- --map <wallet>=<userId> --apply`). Report-only by default and safe to re-run.
- Code always runs through `tsx` (dev, start, and PM2 via `ecosystem.config.cjs`, as `node --import tsx`); there is no compiled output. Prod runs `npm install --omit=dev`, so `tsx` must stay in `dependencies`, not `devDependencies`.
- `.env` is loaded by Node's `--env-file` everywhere (Node errors if the file is missing): in the npm scripts and in PM2's `interpreter_args`. PM2 has no `env_file` option of its own.
- Env (`src/env.ts`, validated at startup): `MONGODB_URI`, `DO_SPACES_CDN_URL`, `DO_SPACES_ENDPOINT` / `REGION` / `KEY` / `SECRET` / `BUCKET` (required; the Space shared with dmbk and lora-trainer); `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (required in production); `BETTER_AUTH_URL` (this API's public URL); `ALLOWED_EMAILS` (who may sign in; empty admits nobody); `ADMIN_EMAILS` (who may curate photos); `ALLOWED_ORIGINS` (CORS: comma-separated hosts that call this API from a browser, e.g. `dmbk.io,*.dmbk.io,localhost:3000`; `*.` matches subdomains, not the apex — `lib/hosts.ts`); `PHOTOS_DB_NAME` / `SOUND_DB_NAME` / `LORA_DB_NAME` / `ACCOUNTS_DB_NAME` (default `dmbk-photos` / `dmbk-sound` / `lora-trainer` / `dmbk-accounts`); `PORT`; `NODE_ENV`.

## Deployment

**Every push to `main` deploys to production.** `.github/workflows/deploy.yml` SSHes into a DigitalOcean droplet, hard-resets `/opt/graphql-api` to `origin/main`, runs `npm ci --omit=dev`, and `pm2 startOrRestart ecosystem.config.cjs --update-env` (starts it on a fresh box, re-reads the ecosystem file otherwise). The script runs under `set -euo pipefail` and fails the job if `localhost:4000` does not answer afterwards. It needs the `DROPLET_HOST` (public IP), `DROPLET_USER` and `DROPLET_SSH_KEY` repo secrets. The deploy job `needs` the `typecheck` job, so a push that fails typecheck never deploys. Caddy terminates TLS for `graphql.dmbk.network` and proxies to port 4000.

## What this is

A Relay GraphQL API (Pothos + Yoga + Mongoose) over data **owned by two other apps** on the same Atlas cluster (`dmbk-world`):

| DB | Collections served | Owning app |
|---|---|---|
| `dmbk-photos` | `photos`, `keywords` | `dblodorn/dmbk` (Next.js; `src/server/api/db.ts` there is the schema source of truth) |
| `dmbk-sound` | `sound_snapshots` (read-only here) | `dblodorn/dmbk` (`src/lib/soundcloud/build-playlists.ts` is the only writer) |
| `lora-trainer` | `lora_trainings`, `generated_images` | `dblodorn/lora-trainer` |
| `dmbk-accounts` | `user`, `account`, `session` | **this API** (better-auth; it manages these collections and their indexes) |

Both apps still read/write these collections directly (tRPC). The plan is to move their clients onto this API and retire their own endpoints — dmbk's `/api/graphql` (`src/server/graphql/`) and the tRPC routers — **one capability at a time, only once the replacement here is live**. Accounts live here, in `dmbk-accounts`; both apps are moving their sign-in onto it (`openspec/changes/google-accounts/`). The `user`/`session`/`account`/`verification`/`walletAddress` collections in the two app DBs belong to those apps' old SIWE setups; this API does not touch them, and they are dropped once both apps have moved.

## Architecture

ESM (`"type": "module"`, `NodeNext`): relative imports need `.js` extensions in `.ts` files.

**Layers.** `models/` (Mongoose schemas) → `lib/*/repository.ts` (every query and write; all visibility rules) → `schema/` (Pothos types and resolvers, thin). Resolvers never build Mongo filters themselves.

**Models mirror foreign documents exactly.** String `_id`s (UUIDs for photos, hex for LoRA records), ISO-8601 *strings* for dates, explicit `collection` names, `versionKey: false`, no Mongoose timestamps. `autoIndex`/`autoCreate` are off globally (`db/mongoose.ts`) because the owning apps manage indexes — never enable them. (`dmbk-accounts` is written by better-auth's own adapter, not Mongoose.) Both DBs share one connection via `useDb(..., { useCache: true })`.

**Visibility lives in the repositories, and the per-request loaders in `context.ts` are pre-scoped to the viewer.** Node lookups (`node(id)`) and nested fields load through those loaders, so a record the viewer may not see resolves to `null` — indistinguishable from nonexistent.
- Photos: public = `status: "ready"` and `hidden: false` (`PUBLIC_SCOPE`); admins (`ADMIN_EMAILS`) see everything. `dmbkPhotos(visibility, states)` with non-default values is *refused* for non-admins, not silently narrowed. `originalKey` is never exposed; URLs are `DO_SPACES_CDN_URL` + derivative key.
- LoRA: public trainings = `completed` and `hidden ≠ true`; public images = `hidden ≠ true`. Owner = the account named by the record's `ownerId`; a record without one has no owner (`scripts/backfill-owner-id.ts`). An image's owner is whoever generated it, not the LoRA's trainer. `walletAddress` is pre-accounts history: kept in the model, never exposed. `hidden` uses `$ne: true` because lora-trainer never backfilled it.
- Privileged fields (`Photo.hidden/status/failureReason`, owner-only `hidden/trainingZipUrl`) use scope-auth with `unauthorizedResolver: () => null` — they resolve to null rather than erroring, so one fragment serves public and admin views.

**Uploads** (`lib/photos/upload.ts`, `lib/spaces/`, `lib/photos/images.ts`) are ported from dmbk's `reserveUpload` / `finalizeUpload` / `delete`; key layout, limits, derivative sizes and failure handling must stay identical while both apps write. Bytes go client → Space through a presigned PUT, never through the API. Finalize runs one photo at a time (an in-process queue, sharp at one thread with no cache) and its derivatives sequentially, unlike dmbk: the whole API shares one 2 GB droplet, and a 50 MB original's decode is large. Storage deletes take the exact keys recorded on the photo, never a prefix — the Space is shared with other apps.

**Keyword counts are shared state.** `lib/photos/keywords.ts` and the `isCounted` rule in `lib/photos/repository.ts` are ported verbatim from dmbk (`src/lib/photos/keywords.ts`, `repository.ts`). While both apps write, any change to normalization or count maintenance must be made in both repos.

**Auth.** better-auth (`auth/better-auth.ts`) with Google as the only provider and the `bearer` plugin (`requireSignature`), built lazily on the Mongoose client. Its HTTP routes are **not mounted**: the browser gets a Google ID token from Google Identity Services, `signInWithGoogle` trades it for a signed session token through `auth.api.signInSocial`, clients send it as `Authorization: Bearer`, the context resolves it with `auth.api.getSession`, and `signOut` revokes it. Sign-up is gated in a `user.create.before` hook (verified email on `ALLOWED_EMAILS`, `auth/allowlist.ts`); every request re-checks `ALLOWED_EMAILS` and derives `isAdmin` from `ADMIN_EMAILS`, so removing an address takes effect immediately. Every sign-in failure is the same generic `AuthError` (`UNAUTHENTICATED`); a bad or revoked token is anonymous, never an error. Scopes: `signedIn`, `admin`.

**Relay.** `Photo`, `LoraTraining`, `GeneratedImage` are `Node`s with Pothos global IDs (base64 `Type:id`). Connections are keyset-paginated on `(createdAt, _id)` newest-first (`lib/cursor.ts`, same cursor encoding as dmbk); forward-only — `last`/`before` are refused. Fields are non-null by default (`builder.ts`); opt into `nullable: true` where a value can be absent. Mutations are `relayMutationField`s (single `input`, payload with the changed node); they return the repository's result, not a loader read, since the loader may hold a pre-mutation copy. Root Query/Mutation fields and `Viewer` fields that touch a database are prefixed with its camelCase name — `dmbkPhotos…` / `dmbkSound…` / `loraTrainer…` — dropping words the prefix already says (`dmbkPhotos`, not `dmbkPhotosPhotos`; `dmbkSoundPlaylists`; `loraTrainerTrainings`). Cross-cutting fields (`_health`, `node(s)`, `viewer`, `signInWithGoogle`, `signOut`), type names and fields nested in node types are unprefixed. Input/payload/connection type names derive from the field name, so they follow automatically.

**Schema registration is by side effect**: `index.ts` imports `schema/queries.js` and `schema/mutations.js`, which import the type modules, before `builder.toSchema()`. A new schema file must be reachable from those imports.

**Errors.** Repositories throw domain errors (`InvalidInputError`, `*NotFoundError`, `ForbiddenError`, `AuthError`); `errors.ts#maskError` maps them to GraphQL `extensions.code`s and masks everything else. Add new domain error classes to its `CODES` table or they surface as "Unexpected error."

## Roadmap

Phased plan, open items and the source files to port live in `docs/plans/2026-10-08-migration-roadmap.md`. Read it before starting on uploads/delete (Phase 2), LoRA training/generation (Phase 3), or moving the dmbk / lora-trainer clients over (Phase 4), and tick off its checkboxes as work lands.
