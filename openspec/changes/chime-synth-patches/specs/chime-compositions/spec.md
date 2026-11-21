# Spec Delta

## MODIFIED Requirements

### Requirement: Composition storage
Compositions SHALL be stored in the `chime_compositions` collection of the `dmbk-sound` database, and this API SHALL be the collection's owner and only writer. Each document SHALL hold exactly these fields: `_id` (a 24-character lowercase hex string assigned by the API), `schemaVersion` (1), `title`, `units` (1–16 unit objects, in page order), `fingerprint` (64 lowercase hex characters), `hidden` (boolean), and `createdAt` (ISO-8601 string). Each unit object SHALL hold exactly:
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

The collection SHALL carry a database-level schema validator, at strict level with the error action. It SHALL enforce these types, ranges, required fields and the absence of any other field. `instrument` and `patch` are allowed but not required, so documents stored before them stay valid. The database therefore SHALL refuse a non-conforming insert or update from any writer.

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

### Requirement: Voice and scale catalog
The API SHALL hold a catalog of windchime's scale names and voice ids, each voice with a display name. The catalog SHALL include windchime's built-in FURIN voice, `v6`, and its external-synth voices, whose ids are `x:` followed by the synth's id (the engine package name without `@dblodorn/` and `-engine`), starting with `x:casio-vz`, displayed as `CASIO VZ-10M`. The catalog SHALL only grow at the end, matching windchime's rule that scales and presets travel as indices, so every stored composition stays valid. A save SHALL be refused when a unit's `scale` is not in the catalog, or its `voice` is neither null nor in the catalog.

#### Scenario: Unknown scale
- **WHEN** a save names the scale `NOT-A-SCALE`
- **THEN** it fails with `BAD_USER_INPUT` naming the unit and field, and nothing is stored

#### Scenario: Unknown voice
- **WHEN** a save gives a unit the voice `s0:9999`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

#### Scenario: FURIN voice
- **WHEN** a save gives a unit the voice `v6`
- **THEN** it is accepted

#### Scenario: External synth voice
- **WHEN** a save gives a unit the voice `x:casio-vz`
- **THEN** it is accepted, and a title naming that unit's instrument uses `CASIO VZ-10M`

#### Scenario: Unknown external synth
- **WHEN** a save gives a unit the voice `x:not-a-synth`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

### Requirement: Anonymous save
`dmbkSoundSaveChimeComposition` SHALL save a composition without a session and SHALL record no account, email, session, IP address or client name with it. Its input SHALL be the units only. Every field SHALL be required except three:
- `voice`: an omitted value means the default voice (null).
- `instrument` (`CHIME` or `FURIN`): an omitted value means `CHIME`.
- `patch`: allowed only on a unit whose voice is an external synth, where an omitted value means null (the synth's INIT patch). A patch on any other unit, or a patch that is not 24 lowercase hex characters, SHALL fail with `BAD_USER_INPUT`. The API SHALL NOT check that the patch exists in the synth's library.

On output, `ChimeUnit.patch` SHALL be the stored patch for an external-synth unit and null for every other unit.

Any field outside the unit shape SHALL be refused. A save that breaks any rule of the composition storage requirement SHALL fail with `BAD_USER_INPUT` and store nothing. The API SHALL assign the id, title, fingerprint and creation time, and set `hidden` to false. It SHALL return the saved composition and whether it was newly created. Like every mutation, it requires a client API key; a keyless request is refused as the playground tier's rules say.

#### Scenario: Save from windchime
- **WHEN** windchime's server, with its key, saves a valid two-unit composition on a visitor's behalf
- **THEN** the response holds a `ChimeComposition` with a global ID, a generated title, the two units as given and `created: true`, and the document carries no account or IP

#### Scenario: Save without an instrument
- **WHEN** a client that predates the instrument field saves units without `instrument`
- **THEN** the save succeeds, and every unit is stored and returned with `instrument: CHIME`

#### Scenario: Save a furin
- **WHEN** a save gives a unit `instrument: FURIN`
- **THEN** the unit is stored and returned with `instrument: FURIN`

#### Scenario: Out-of-range input
- **WHEN** a save gives a unit `decay: 500`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

#### Scenario: Too many units
- **WHEN** a save gives 17 units, or none
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

#### Scenario: Keyless save
- **WHEN** a request without an API key sends `dmbkSoundSaveChimeComposition` while key enforcement is on
- **THEN** it fails with `FORBIDDEN`, and nothing is stored

#### Scenario: Save an external synth unit
- **WHEN** a save gives one unit `voice: "x:casio-vz"` with a 24-hex `patch` and another `voice: "x:casio-vz"` without `patch`
- **THEN** the first is stored and returned with that patch, and the second with `patch: null`

#### Scenario: Patch on a soundfont unit
- **WHEN** a save gives a unit `voice: "v2"` and a `patch`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

#### Scenario: Malformed patch
- **WHEN** a save gives an external-synth unit `patch: "ABC"`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

### Requirement: Duplicate saves
The fingerprint SHALL be a hash of the composition's units in a canonical form, so two saves of identical units produce the same fingerprint. A tube-chime unit SHALL contribute exactly what it did before `instrument` existed, so every stored composition keeps its fingerprint. A furin unit SHALL hash differently from a tube-chime unit with the same other values. An external-synth unit's `patch` SHALL be part of its hash, so units differing only in patch (or INIT versus a shared patch) hash differently, and units that are not external synths SHALL contribute exactly what they did before `patch` existed. At most one composition SHALL exist per fingerprint. Saving units identical to a stored composition SHALL return that composition with `created: false` and store nothing new. This SHALL hold even when the stored one is hidden: a hidden composition is not re-listed by saving it again.

#### Scenario: Same composition twice
- **WHEN** the same units are saved twice
- **THEN** both responses carry the same composition id, the second has `created: false`, and the collection holds one document

#### Scenario: Moved unit is a new composition
- **WHEN** a composition is saved, then saved again with one unit's `x` changed
- **THEN** a second composition is created

#### Scenario: Composition stored before the instrument field
- **WHEN** a tube-chime composition stored before `instrument` existed is saved again, with or without `instrument: CHIME` on its units
- **THEN** the stored composition is returned with `created: false`

#### Scenario: Instrument changed
- **WHEN** a composition is saved, then saved again with one unit's `instrument` changed to `FURIN`
- **THEN** a second composition is created

#### Scenario: Patch changed
- **WHEN** a composition with an external-synth unit is saved, then saved again with that unit's `patch` changed
- **THEN** a second composition is created

#### Scenario: Stored fingerprints unchanged
- **WHEN** the fingerprint of every composition stored before `patch` existed is computed again
- **THEN** each equals its stored fingerprint
