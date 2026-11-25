# Spec Delta

## ADDED Requirements

### Requirement: Arpeggiator settings
A Juno-60 patch MAY carry arpeggiator settings beside its bytes, never inside them: `version` (1), `on`, `mode`
(`UP`, `DOWN`, `UP_DOWN`), `range` (1, 2 or 3) and `rate` (0–127), exposed as `Juno60Voice.arpeggio` (null when
none). Save and update SHALL accept them as an optional input, refuse a field out of range with `BAD_USER_INPUT`
naming it, and store settings equal to the default (off, UP, 1, 64) as none. An update without settings SHALL remove
the stored ones. The duplicate rule SHALL cover the bytes and the settings together; a patch without settings SHALL
keep the bytes-only fingerprint.

#### Scenario: Same sound, two arpeggios
- **WHEN** one key saves the same bytes once without settings and once with an arpeggio on
- **THEN** two patches are stored, and saving the second again returns it with `created: false`

#### Scenario: Default settings
- **WHEN** a patch is saved with the arpeggiator off, UP, range 1, rate 64
- **THEN** it is stored with no settings, as the same patch as one saved without them

#### Scenario: Refused settings
- **WHEN** a save sends `range: 4`
- **THEN** it fails with `BAD_USER_INPUT` naming `arpeggio.range`

## MODIFIED Requirements

### Requirement: Patch storage
Juno-60 patches SHALL be stored in the `juno60_voices` collection of `dmbk-sound`, with this API as owner and only
writer. Each document SHALL have exactly the fields of a VZ voice document, plus an optional `arpeggio` subdocument.
`data` SHALL be the juno60 editor's 42 patch bytes (its own layout; the Juno-60 publishes no data format), base64, 56
characters. The collection SHALL carry a strict validator.

#### Scenario: Validator
- **WHEN** a document with `arpeggio.range` 4, or with an extra field in `arpeggio`, is inserted directly
- **THEN** the collection refuses it
