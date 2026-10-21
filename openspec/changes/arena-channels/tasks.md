# Tasks

Ordered across repos. Every merge to `main` here deploys. lora-trainer's PR depends on this API's PR being deployed.

## 0. Spike (no merged code)

- [ ] 0.1 With the owner's Are.na slug, check anonymously:
  - Does `users/{slug}/contents?type=Channel` include every public/closed channel they made, group-owned ones too?
  - Does `users/{slug}/groups` list their groups?
  - Does `groups/{id}/contents?type=Channel` return those groups' public channels?

  Note counts and call totals in design.md.

## 1. API PR (this repo)

- [x] 1.1 `src/lib/arena/client.ts`:
  - A v3 client: `user(slug)`, `userChannels(id, page)`, `userGroups(id, page)`, `groupChannels(id, page)`, `channel(slug)`, `channelContents(id, page, per)`.
  - Base URL from `ARENA_API_URL` (defaulting to `https://api.are.na/v3`), with a 10s timeout and zod for the fields used.
  - Maps 404 → `ArenaNotFound`, 429 → `RATE_LIMITED`, and anything else → `UPSTREAM_ERROR`.
  - Drops `visibility: "private"` in every list and lookup.
- [x] 1.2 `src/lib/arena/profile.ts`: `getProfile(userId)`, `setProfile(userId, slug)` (looks up the user first) and `clearProfile(userId)`, on `dmbk-accounts.arena_profiles`. Ensure the unique `userId` index on first use.
- [x] 1.3 `src/lib/arena/channels.ts`:
  - Merge own and group channels (group fetches at concurrency 4; a failed group is logged and skipped).
  - De-duplicate by id, sort by `updated_at` descending, cap at 1,000.
- [x] 1.4 Schema (`src/schema/types/arena.ts`, `mutations.ts`, `queries.ts`, `viewer.ts`):
  - `ArenaUser`, `ArenaChannel`, `ArenaChannelOwner`, `ArenaImage` and the enums `ArenaVisibility` / `ArenaChannelSource`.
  - `Viewer.arena`, `arenaChannel(slug)`, `arenaSetUser` and `arenaClearUser`.
  - `src/errors.ts` gains `RATE_LIMITED` / `UPSTREAM_ERROR`.
- [x] 1.5 `scripts/test-mutations.ts`: a local stub Are.na (`ARENA_API_URL`) covering:
  - save and clear
  - an unknown slug
  - anonymous refusal
  - own plus group channels de-duplicated
  - one failing group
  - a private channel filtered from lists and from `arenaChannel`
  - a 429
- [x] 1.6 Docs: README (the schema), CLAUDE.md / AGENTS.md (the `arena_profiles` row in the DB table, and the Are.na section), and the note on the `arena` prefix.
- [ ] 1.7 `npm run typecheck`, tests, merge and deploy.

## 2. lora-trainer PR (`dblodorn/lora-trainer`)

- [ ] 2.1 `src/server/api/features/arena.ts`:
  - `getChannelImages` calls the API's `arenaChannel` (slug from the URL, all pages up to the current 100-image behaviour).
  - Add `profile`, `setUser`, `clearUser` and `myChannels`, forwarding the viewer's bearer.
  - Remove `are.na`, `types/arena.d.ts` and the v2 fetch.
- [ ] 2.2 `/auth`: an "Are.na username" field with save/clear, showing the saved user.
- [ ] 2.3 Train page:
  - A channel picker (own / group) next to the URL field. Picking a channel fills the URL and loads it.
  - Pasting keeps working without a saved username.
- [ ] 2.4 Typecheck, then verify on production: save your username, see your own and group channels, train on one, clear it.

## 3. Later (not in this change)

- [ ] 3.1 Private channels via Are.na OAuth: one redirect URI per Are.na application, so use either one application per environment or a single API-hosted callback with a ticket hand-off (design, Later).
- [ ] 3.2 Archive this change.
