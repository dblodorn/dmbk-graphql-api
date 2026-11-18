# Tasks

## 1. Field

- [x] 1.1 Add `image: string | null` to `Viewer` and return `image: user.image || null` from `viewerFor` in `src/auth/viewer.ts`. Expose it as `t.exposeString('image', { nullable: true })` in `src/schema/types/viewer.ts`. Verify with `npm run typecheck`.
- [x] 1.2 Check against a local server (`npm run dev`):
  - `viewer { id email name image isAdmin }` through `npm run test:mutations` (its auth suite now gives the admin test account a picture and checks `image` is that URL for it and null for the member);
  - anonymous `{ viewer { image } }` gives `viewer: null`;
  - the printed schema shows `image: String` on `Viewer`.

## 2. Docs and rollout

- [x] 2.1 Update CLAUDE.md where it lists viewer fields, if anywhere.
- [ ] 2.2 After merging (which deploys): query `{ viewer { image } }` on production with a real session and see a URL. Refresh dmbk-photo's schema copy with `pnpm schema:pull:api`.
