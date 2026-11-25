# Tasks

## 1. Implementation

- [x] 1.1 `src/lib/juno60/arpeggio.ts`: `checkArpeggio` (default → none, fields named) and `juno60JsonSchema`; verified by a script against the rules
- [x] 1.2 Repository extras (`VoiceExtra`), the fingerprint rule and update's replace; model field; verified on a throwaway collection with the validator (save, duplicate, update remove and set)
- [x] 1.3 GraphQL: `Juno60Arpeggio`, `Juno60ArpeggioMode`, `Juno60ArpeggioInput` on save and update; verified against a local server (`arpeggio: null` on stored patches)
- [x] 1.4 `scripts/test-mutations.ts`: a Juno-60 suite (arpeggio round trip, default as none, refused fields, update removes); `npm run typecheck` passes

## 2. Deploy

- [x] 2.1 `npm run juno60:collection -- --apply` before merging; verify it reports the validator up to date
- [ ] 2.2 Merge and deploy; verify production returns `arpeggio: null` for the factory patches
