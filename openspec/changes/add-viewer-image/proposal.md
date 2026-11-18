# Proposal

## Why

The album-artwork editor (create-album-artwork) is adding Google sign-in through this API and wants to show the signed-in account's avatar. better-auth already stores the Google profile picture on the user record (`user.image`), but `Viewer` doesn't expose it.

## What Changes

- Add a nullable `image` field to `Viewer`: the account's Google profile picture URL as better-auth stored it, or null.
- No new data, permissions or behaviour: the field reads what's already on the user record, for the signed-in viewer only.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `accounts-auth`: "Viewer identity fields" adds `image` (nullable).

## Impact

- `src/auth/viewer.ts` (the `Viewer` shape and `viewerFor`) and `src/schema/types/viewer.ts`.
- Additive schema change: no client breaks. dmbk-photo's checked-in schema copy should be refreshed (`pnpm schema:pull:api`).
- Accounts created before better-auth stored a picture, or whose Google account has none, read `null`.
