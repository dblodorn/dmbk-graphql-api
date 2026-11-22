# dx7-voices Specification

## Purpose
How voices made in the DX7 editor (dx7.dmbk.io) are saved anonymously to `dmbk-sound.dx7_voices`, on the same plan as VZ voices: owned by a device key, listed publicly, changed or deleted by their creator, hidden by an admin.

## Requirements

### Requirement: Voice storage
DX7 voices SHALL be stored in the `dx7_voices` collection of `dmbk-sound`, with this API as owner and only writer. Each document SHALL have exactly the fields of a VZ voice document. `data` SHALL be the 155 unpacked VCED bytes of a DX7 voice, base64, 208 characters. The collection SHALL carry a strict validator.

#### Scenario: Database refuses an extra field
- **WHEN** any client inserts a document into `dx7_voices` with a field not listed
- **THEN** MongoDB rejects the write

### Requirement: Data and name
A save or update SHALL accept `data` only when it is 208 base64 characters decoding to 155 bytes, else `BAD_USER_INPUT`. The name SHALL be read from bytes 145–154, trailing spaces trimmed, never taken from the client. Obscene names SHALL be refused as for VZ voices.

#### Scenario: A VZ voice sent to the DX7 library
- **WHEN** a save sends 336 bytes
- **THEN** it fails with `BAD_USER_INPUT`

### Requirement: Ownership, listing and limits
DX7 voices SHALL follow the VZ voices' rules for device-key ownership (stored as `sha256("dx7-creator:" + key)`), duplicates per key, update, delete, admin hiding, the newest-first listing with `creatorKey` and `search` (at most 10 characters), and write budgets (their own, `DX7_WRITE_*`).

#### Scenario: Another device tries to update
- **WHEN** key B updates a voice saved by key A
- **THEN** it fails with `FORBIDDEN`

### Requirement: Synth patch
`Dx7Voice` SHALL implement `SynthPatch`, so `node(id) { ... on SynthPatch { name data } }` returns a DX7 voice's name and bytes. A VZ voice SHALL still resolve as `VzVoice` and a DX7 voice as `Dx7Voice`.

#### Scenario: Windchime fetches a DX7 patch
- **WHEN** `node(id)` is asked for a saved DX7 voice's global id
- **THEN** its `__typename` is `Dx7Voice` and `name` and `data` are the stored ones

### Requirement: Banks
DX7 banks SHALL be stored in `dmbk-sound.dx7_banks`, each a name (1–20 printable ASCII characters, checked like voice names) and exactly 32 slots holding a saved, visible DX7 voice's id or null. A bank is like a cartridge, and its slots may name anyone's voices. Banks SHALL follow the voices' rules for device-key ownership (the same `dx7-creator` hash), duplicates per key, update, delete, admin hiding, write budget and the newest-first listing (`dmbkSoundDx7Banks`, with `creatorKey` and `search` up to 20 characters). A slot whose voice is later deleted or hidden SHALL read as null. Deleting a bank SHALL NOT delete its voices.

#### Scenario: A slot names a missing voice
- **WHEN** a save sends a slot with a Dx7Voice ID that doesn't exist, or a VzVoice ID
- **THEN** it fails with `BAD_USER_INPUT` and nothing is stored

#### Scenario: Factory cards
- **WHEN** the listing is read after the factory import
- **THEN** it holds the banks ROM1A to ROM4B, each with its 32 voices in cartridge order, ROM1A first
