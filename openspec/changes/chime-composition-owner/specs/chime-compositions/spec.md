# Spec Delta

## ADDED Requirements

### Requirement: Device key ownership
A save MAY carry a `creatorKey`: the saving browser's device key, 43 base64url characters (32 random bytes), the same kind of key the synth libraries use. A malformed key SHALL fail the save with `BAD_USER_INPUT` and store nothing. When a save with a key creates a new composition, the document SHALL hold `creatorHash` = `sha256("chime-creator:" + creatorKey)`, and the API SHALL NOT store or log the key itself. A save that returns an existing composition (see "Duplicate saves") SHALL NOT add, change or remove its `creatorHash`, whichever key it carries. A save without a key SHALL store no `creatorHash`. `creatorHash` SHALL NOT be part of the fingerprint or the title, and SHALL NOT be exposed. Ownership grants nothing beyond being marked and listed: compositions still cannot be changed or deleted through the API.

`ChimeComposition.yours(creatorKey)` SHALL be true only when that key created the composition, and false for any other key, a malformed key, or a composition without `creatorHash`. `dmbkSoundChimeCompositions(creatorKey)` SHALL narrow the public listing to visible compositions that key created, newest first; a malformed key there SHALL fail with `BAD_USER_INPUT`.

#### Scenario: Save with a key
- **WHEN** a client saves new units with key A
- **THEN** the stored document holds `creatorHash` = `sha256("chime-creator:" + A)` and no field holds A itself

#### Scenario: Duplicate keeps its owner
- **WHEN** key A saves units, then key B saves the identical units
- **THEN** key B gets A's composition with `created: false`, its `creatorHash` is still A's, `yours(creatorKey: B)` is false and `yours(creatorKey: A)` is true

#### Scenario: Keyless save
- **WHEN** a client saves new units without `creatorKey`
- **THEN** the composition is stored without `creatorHash`, and `yours` is false for every key

#### Scenario: Malformed key
- **WHEN** a save passes `creatorKey: "abc"`
- **THEN** it fails with `BAD_USER_INPUT` and nothing is stored

#### Scenario: Listing one key's compositions
- **WHEN** a client lists `dmbkSoundChimeCompositions(first: 20, creatorKey: A)`
- **THEN** only visible compositions created with key A are returned, newest first

#### Scenario: Fingerprints unchanged
- **WHEN** the fingerprint of a composition saved with a key is computed
- **THEN** it equals the fingerprint of the same units saved without one

## MODIFIED Requirements

### Requirement: Composition storage
Compositions SHALL be stored in the `chime_compositions` collection of the `dmbk-sound` database, and this API SHALL be the collection's owner and only writer. Each document SHALL hold exactly these fields: `_id` (a 24-character lowercase hex string assigned by the API), `schemaVersion` (1), `title`, `units` (1–16 unit objects, in page order), `fingerprint` (64 lowercase hex characters), `hidden` (boolean), and `createdAt` (ISO-8601 string), and MAY hold `creatorHash` (64 lowercase hex characters; see "Device key ownership"). Each unit object SHALL hold exactly:
- `volume`: integer 0–100 (percent)
- `tubes`: integer 2–8
- `wind`: integer 0–100 (percent)
- `decay`: integer 3–120 (tenths of a second)
- `cutoff`: integer 0–1000 (the FREQUENCY slider ×1000)
- `resonance`: integer 5–180 (×10)
- `root`: integer 0–119 (MIDI note, C-1 to B8)
- `scale`: a scale name from the catalog
- `voice`: null or a voice id from the catalog
- `channel`: integer 1–16
- `midiMode`: `"poly"` or `"mono"`
- `notes`: boolean
- `x`, `y`: integers −32768–32767
- `rank`: integer 0–15, the unit's stacking order

A unit object MAY also hold `patch` and `instrument`.

`patch` is null or a 24-character lowercase hex string: the id of a patch in the library of the unit's external synth, with null meaning that synth's INIT patch. A unit SHALL hold `patch` when its `voice` is an external-synth voice (`x:<synth>`), and SHALL NOT hold it otherwise.

`instrument` is either `"chime"` (the tube chime) or `"furin"` (the furin bell). Every unit the API saves SHALL hold it. A stored unit without it SHALL be read as `"chime"`. A furin unit still holds `tubes` and `scale`, which windchime keeps for when the unit switches back to a tube chime.

The collection SHALL carry a database-level schema validator, at strict level with the error action. It SHALL enforce these types, ranges, required fields and the absence of any other field. `instrument`, `patch` and the document's `creatorHash` are allowed but not required, so documents stored before them stay valid. The database therefore SHALL refuse a non-conforming insert or update from any writer.

#### Scenario: Database refuses an extra field
- **WHEN** any client inserts a document into `chime_compositions` with a field not listed above, or with a unit missing `scale`
- **THEN** MongoDB rejects the write with a document validation error and nothing is stored

#### Scenario: Database refuses an out-of-range value
- **WHEN** any client inserts a document whose unit has `tubes: 9`, `volume: 0.5` or `instrument: "bell"`
- **THEN** MongoDB rejects the write

#### Scenario: Database refuses a malformed patch
- **WHEN** any client inserts a document whose unit has `patch: "XYZ"` or a 23-character hex string
- **THEN** MongoDB rejects the write

#### Scenario: Older document without an instrument
- **WHEN** a composition stored before `instrument` existed is listed or loaded
- **THEN** each of its units is returned with `instrument: CHIME`, and the document is otherwise unchanged

#### Scenario: Full root range
- **WHEN** a composition whose units have `root: 0` and `root: 119` is saved
- **THEN** it is stored, and a unit with `root: 120` or `root: -1` is refused

#### Scenario: Older documents stay valid
- **WHEN** the validator with `patch` is applied to the collection
- **THEN** every document stored before it still validates, and none of them gains a `patch` field

#### Scenario: Database refuses a malformed creator hash
- **WHEN** any client inserts a document whose `creatorHash` is not 64 lowercase hex characters
- **THEN** MongoDB rejects the write

#### Scenario: Owner-less documents stay valid
- **WHEN** the validator with `creatorHash` is applied to the collection
- **THEN** every document stored before it still validates, and none of them gains a `creatorHash`
