# Tasks

## 1. Range

- [x] 1.1 Change `INT_FIELDS.root` to `[0, 119]` in `src/lib/chime/shape.ts`.
- [x] 1.2 Check:
  - `npm run typecheck`.
  - The generated JSON schema shows `minimum 0` and `maximum 119` for `root`.
  - The zod parse accepts 0 and 119 and refuses −1 and 120.
  - The fingerprint for an existing composition is unchanged.

## 2. Docs and rollout

- [x] 2.1 Update CLAUDE.md wherever it names the range.
- [x] 2.2 After merging: run `npm run chime:collection -- --apply` (with `dbAdmin`), then deploy.
