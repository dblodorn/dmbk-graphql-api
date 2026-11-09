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

A unit object MAY also hold `instrument`, either `"chime"` (the tube chime) or `"furin"` (the furin bell). Every unit the API saves SHALL hold it. A stored unit without it SHALL be read as `"chime"`. A furin unit still holds `tubes` and `scale`, which windchime keeps for when the unit switches back to a tube chime.

The collection SHALL carry a database-level schema validator, at strict level with the error action. It SHALL enforce these types, ranges, required fields and the absence of any other field. `instrument` is allowed but not required, so documents stored before it existed stay valid. The database therefore SHALL refuse a non-conforming insert or update from any writer.

#### Scenario: Database refuses an extra field
- **WHEN** any client inserts a document into `chime_compositions` with a field not listed above, or with a unit missing `scale`
- **THEN** MongoDB rejects the write with a document validation error and nothing is stored

#### Scenario: Database refuses an out-of-range value
- **WHEN** any client inserts a document whose unit has `tubes: 9`, `volume: 0.5` or `instrument: "bell"`
- **THEN** MongoDB rejects the write

#### Scenario: Older document without an instrument
- **WHEN** a composition stored before `instrument` existed is listed or loaded
- **THEN** each of its units is returned with `instrument: CHIME`, and the document is otherwise unchanged

#### Scenario: Full root range
- **WHEN** a composition whose units have `root: 0` and `root: 119` is saved
- **THEN** it is stored, and a unit with `root: 120` or `root: -1` is refused
