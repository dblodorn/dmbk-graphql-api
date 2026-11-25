# Proposal

## Why

The juno60 editor is gaining the Juno-60's arpeggiator (dblodorn/juno60, change `juno60-arpeggiator`), and players
want an arpeggio to belong to a sound, in SHARED and in windchime. The settings must travel beside the 42 patch
bytes, never inside them: `data` stays the sound, and its length still tells the synth libraries apart.

## What Changes

- `Juno60Voice` gains `arpeggio: Juno60Arpeggio` (nullable): `version`, `on`, `mode` (`UP`, `DOWN`, `UP_DOWN`),
  `range` (1–3), `rate` (0–127). Null means the arpeggiator is off.
- `dmbkSoundSaveJuno60Voice` and `dmbkSoundUpdateJuno60Voice` take an optional `Juno60ArpeggioInput`, checked by
  the same rules as the engine's `readArpeggio` (`BAD_USER_INPUT` naming the field). Settings equal to the default
  (off, UP, 1, 64) are stored as none. An update without it removes the stored settings.
- The duplicate rule covers the bytes and the settings: the same sound with two arpeggios is two patches. Patches
  without settings keep their fingerprints exactly.
- The `juno60_voices` validator allows the optional `arpeggio` subdocument. No migration.
- Not breaking: `data`, `SynthPatch`, the VZ and DX7 libraries and every stored document are unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities

- `juno60-voices`: patch storage gains the optional arpeggio; save and update accept it; the duplicate rule covers it.

## Impact

`src/lib/juno60/arpeggio.ts` (new), `src/lib/synth-voices/repository.ts` (extras beside the bytes),
`src/models/synth-voice.ts`, `src/schema/types/juno60.ts`, `src/schema/mutations.ts`,
`scripts/juno60-voices-collection.ts` (validator; run with `--apply` before deploying), `scripts/test-mutations.ts`
(a Juno-60 suite). Clients: the juno60 editor (SHARED) and windchime read and write it after this deploys.
