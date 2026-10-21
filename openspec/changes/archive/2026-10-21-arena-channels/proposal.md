# Proposal

## Why

lora-trainer trains on Are.na channels, but it only knows a channel when you paste its URL. It reads through Are.na's v2 API and the old `are.na` package. Picking from your own channels would be quicker, and the v2 API is on its way out.

Only public channels are wanted, including public channels in groups you belong to. Are.na's v3 API serves all of these without authentication. So no Are.na OAuth, token or redirect URI is needed (Are.na allows only one redirect URI per application anyway). The account just needs to know its Are.na username.

This API owns accounts (`google-accounts`), so the Are.na username is stored here, and the Are.na reads go through here too, so dmbk can use them later without its own client.

## What Changes

- **New:** an account can save its Are.na username. `arenaSetUser(input: { slug })` checks that the user exists on Are.na and stores its id and slug against the account. `arenaClearUser` removes it.
- **New:** `Viewer.arena` returns the saved Are.na user and `channels`: their public and closed channels, including ones they made in groups, plus public channels in the groups they belong to.
- **New:** `arenaChannel(slug)` returns a public or closed channel and its image blocks. A private channel, or one that doesn't exist, returns null.
- **Cross-repo, tracked here:** lora-trainer gets:
  - an Are.na username field on `/auth`
  - a channel picker on the Train page
  - channel reads through this API in place of v2 and the `are.na` package

Not included: private channels, Are.na OAuth or tokens, writes to Are.na, and anything in dmbk.

## Capabilities

### New Capabilities
- `arena-channels`: the account's Are.na username and the schema fields for reading its public Are.na channels.

### Modified Capabilities
<!-- None. accounts-auth is unchanged. -->

## Impact

- **This repo:**
  - New: `src/lib/arena/` (the v3 client and the profile store) and `src/schema/types/arena.ts`.
  - New collection `dmbk-accounts.arena_profiles`.
  - Mutations and queries are registered.
  - Test coverage goes in `scripts/test-mutations.ts`.
  - No new env, apart from an optional `ARENA_API_URL` for tests.
- **Are.na:** nothing to register.
- **lora-trainer:** a username field, a channel picker, and `arena.ts` moved onto this API, with the `are.na` dependency removed.
- **Deploy:** the API ships first, then lora-trainer.
