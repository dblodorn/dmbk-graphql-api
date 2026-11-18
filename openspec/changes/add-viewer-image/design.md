# Design

## Context

`viewerFor(user)` in `src/auth/viewer.ts` builds the `Viewer` from better-auth's user (from `getSession` and from `signInSocial`). better-auth's Google provider maps the ID token's `picture` to `user.image` when the user is created. The account is only re-read on later sign-ins if better-auth's `overrideUserInfoOnSignIn` is set, which it isn't here.

## Goals / Non-Goals

**Goals:** expose the stored picture as `Viewer.image`.

**Non-Goals:**
- Refreshing pictures on sign-in.
- Proxying or caching images.
- Adding pictures anywhere but `Viewer`.

## Decisions

- **Pass the field through `viewerFor`.** Return `image: user.image || null`, so an empty string reads as null, and expose it with `t.exposeString('image', { nullable: true })`.
  - *Alternative:* resolve it with a separate user lookup in the schema. Rejected: the session already carries the user record, so no extra query is needed.
- **No refresh on sign-in.** Turning on `overrideUserInfoOnSignIn` would also overwrite `name` on every sign-in. A stale picture is harmless, so this stays a separate decision.

## Risks / Trade-offs

- **[Stale picture]** A person who changes their Google picture keeps the old URL until better-auth updates the record. → Acceptable for an avatar. Clients fall back to initials when the image fails to load.
- **[Google image URLs refuse hotlinks that send a referrer]** → Clients load them with `referrerpolicy="no-referrer"`. Noted for client authors.

## Migration Plan

Additive. Deploy with the next push to `main`. Rollback: revert. Clients treat a missing picture as null, but only once they request the field, so deploy this before any client requests `image`.
