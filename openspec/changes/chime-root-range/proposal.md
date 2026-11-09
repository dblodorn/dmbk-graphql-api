# Proposal

## Why

windchime is splitting ROOT into a 12-note picker and an OCTAVE from −1 to 8, so a unit's root can now be any MIDI note from 0 (C-1) to 119 (B8). The API accepts only 48–84 (C3–C6), so saving any root outside that range would be refused.

## What Changes

- A unit's `root` accepts integers from 0 to 119, where it accepted 48–84. This applies to the GraphQL input, the zod check and the collection's validator.
- Stored documents, titles and fingerprints are unchanged. The title already uses the note name without its octave, and the fingerprint hashes the stored integer as before.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chime-compositions`: the unit `root` range in "Composition storage" widens to 0–119.

## Impact

- `src/lib/chime/shape.ts` (`INT_FIELDS.root`). The JSON schema for the validator and the GraphQL field description follow from it.
- The collection validator must be re-applied with `npm run chime:collection -- --apply` (needs `dbAdmin`) before windchime ships the wider range.
- `CLAUDE.md` if it names the range.
