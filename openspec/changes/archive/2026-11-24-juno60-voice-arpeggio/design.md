# Design

## Context

Every synth library shares `lib/synth-voices` (one document shape, one repository) and is told apart by `data`'s
length. See proposal.md for why.

## Goals / Non-Goals

**Goals:** keep the arpeggio beside `data` for Juno-60 patches only, with no change to stored documents or to the
VZ and DX7 libraries. **Non-Goals:** parsing patch bytes; arpeggios for other synths; a separate arpeggio library.

## Decisions

- **Extras in the shared repository**, not a Juno-60 fork of it: `saveVoice`/`updateVoice` take an optional
  `VoiceExtra` (`{ arpeggio? }`). Only the Juno-60 mutations pass one, and the VZ and DX7 validators still refuse the
  field, so it can't leak into their collections. Alternative: a Juno-60 repository copy, rejected as duplication.
- **Fingerprint**: the bytes' SHA-256 when there are no extras (every stored fingerprint stays valid); otherwise
  SHA-256 of the bytes then the extras' canonical JSON. Alternative: bytes only, rejected because the same sound
  with two arpeggios would collide on the unique index.
- **Default stored as none**, so "no settings" has one representation and a patch saved with the arpeggiator off
  is the same patch as one saved before arpeggios existed.
- **Update replaces**: an update without `arpeggio` removes it, since the editor always sends the patch's current
  settings.

## Risks / Trade-offs

- [The validator must allow `arpeggio` before the code writes it] → `juno60:collection -- --apply` runs before the
  deploy; the change only widens what's allowed.
- [`rate` must be stored as a BSON int] → the driver stores whole numbers in int32 range as int32; checked against a
  throwaway collection with the validator.
