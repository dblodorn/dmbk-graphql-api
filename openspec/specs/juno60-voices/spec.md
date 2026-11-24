# juno60-voices Specification

## Purpose
How patches made in the Juno-60 editor (juno60.dmbk.io) are saved anonymously to `dmbk-sound.juno60_voices`, on the
same plan as VZ and DX7 voices: owned by a device key, listed publicly, changed or deleted by their creator, hidden
by an admin. Roland's 56 factory patches are among them.

## Requirements

### Requirement: Patch storage
Juno-60 patches SHALL be stored in the `juno60_voices` collection of `dmbk-sound`, with this API as owner and only
writer. Each document SHALL have exactly the fields of a VZ voice document. `data` SHALL be the juno60 editor's 42
patch bytes (its own layout; the Juno-60 publishes no data format), base64, 56 characters. The collection SHALL carry a
strict validator.

### Requirement: Data and name
A save or update SHALL accept `data` only when it is 56 base64 characters decoding to 42 bytes, else `BAD_USER_INPUT`.
The name SHALL be read from bytes 26–41, trailing spaces trimmed, never taken from the client. Obscene names SHALL be
refused as for VZ voices.

#### Scenario: A DX7 voice sent to the Juno-60 library
- **WHEN** a save sends 155 bytes
- **THEN** it fails with `BAD_USER_INPUT`

### Requirement: Ownership, listing and limits
Juno-60 patches SHALL follow the VZ voices' rules for device-key ownership (stored as `sha256("juno60-creator:" + key)`),
duplicates per key, update, delete, admin hiding, the newest-first listing (`dmbkSoundJuno60Voices`, with `creatorKey`
and `search` of at most 16 characters), and write budgets (their own, `JUNO60_WRITE_*`).

### Requirement: Synth patch
`Juno60Voice` SHALL implement `SynthPatch`. VZ voices, DX7 voices and Juno-60 patches SHALL each resolve as their own
type (told apart by the length of `data`).

#### Scenario: Windchime fetches a Juno-60 patch
- **WHEN** `node(id)` is asked for a saved Juno-60 patch's global id
- **THEN** its `__typename` is `Juno60Voice` and `name` and `data` are the stored ones

### Requirement: Factory patches
`npm run juno60:import -- --apply <files.json>` SHALL save the patches of juno60 editor patch files under
`JUNO60_IMPORT_KEY` through the same save path as the editor, so re-running saves nothing new.
