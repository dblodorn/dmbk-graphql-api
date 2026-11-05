## Purpose

How compositions made in windchime (the Chime player at chime.dmbk.io) are saved anonymously to `dmbk-sound.chime_compositions`, validated strictly, given a title derived from their contents, listed publicly for anyone to load, and hidden by an admin when needed.

## ADDED Requirements

### Requirement: Composition storage
Compositions SHALL be stored in the `chime_compositions` collection of the `dmbk-sound` database, and this API SHALL be the collection's owner and only writer. Each document SHALL hold exactly these fields: `_id` (a 24-character lowercase hex string assigned by the API), `schemaVersion` (1), `title`, `units` (1–16 unit objects, in page order), `fingerprint` (64 lowercase hex characters), `hidden` (boolean), and `createdAt` (ISO-8601 string). Each unit object SHALL hold exactly:
- `volume`: integer 0–100 (percent)
- `tubes`: integer 2–8
- `wind`: integer 0–100 (percent)
- `decay`: integer 3–120 (tenths of a second)
- `cutoff`: integer 0–1000 (the FREQUENCY slider ×1000)
- `resonance`: integer 5–180 (×10)
- `root`: integer 48–84 (MIDI note)
- `scale`: a scale name from the catalog
- `voice`: null or a voice id from the catalog
- `channel`: integer 1–16
- `midiMode`: `"poly"` or `"mono"`
- `notes`: boolean
- `x`, `y`: integers −32768–32767
- `rank`: integer 0–15, the unit's stacking order

The collection SHALL carry a database-level schema validator, at strict level with the error action, that enforces these types, ranges, required fields and the absence of any other field. The database therefore SHALL refuse a non-conforming insert or update from any writer.

#### Scenario: Database refuses an extra field
- **WHEN** any client inserts a document into `chime_compositions` with a field not listed above, or with a unit missing `scale`
- **THEN** MongoDB rejects the write with a document validation error and nothing is stored

#### Scenario: Database refuses an out-of-range value
- **WHEN** any client inserts a document whose unit has `tubes: 9` or `volume: 0.5`
- **THEN** MongoDB rejects the write

### Requirement: Voice and scale catalog
The API SHALL hold a catalog of windchime's scale names and voice ids, each voice with a display name. The catalog SHALL only grow at the end, matching windchime's rule that scales and presets travel as indices, so every stored composition stays valid. A save SHALL be refused when a unit's `scale` is not in the catalog, or its `voice` is neither null nor in the catalog.

#### Scenario: Unknown scale
- **WHEN** a save names the scale `NOT-A-SCALE`
- **THEN** it fails with `BAD_USER_INPUT` naming the unit and field, and nothing is stored

#### Scenario: Unknown voice
- **WHEN** a save gives a unit the voice `s0:9999`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

### Requirement: Anonymous save
`dmbkSoundSaveChimeComposition` SHALL save a composition without a session and SHALL record no account, email, session, IP address or client name with it. Its input SHALL be the units only. Every field SHALL be required except `voice`, where an omitted value means the default voice (null). Any field outside the unit shape SHALL be refused. A save that breaks any rule of the composition storage requirement SHALL fail with `BAD_USER_INPUT` and store nothing. The API SHALL assign the id, title, fingerprint and creation time, and set `hidden` to false. It SHALL return the saved composition and whether it was newly created. Like every mutation, it requires a client API key; a keyless request is refused as the playground tier's rules say.

#### Scenario: Save from windchime
- **WHEN** windchime's server, with its key, saves a valid two-unit composition on a visitor's behalf
- **THEN** the response holds a `ChimeComposition` with a global ID, a generated title, the two units as given and `created: true`, and the document carries no account or IP

#### Scenario: Out-of-range input
- **WHEN** a save gives a unit `decay: 500`
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

#### Scenario: Too many units
- **WHEN** a save gives 17 units, or none
- **THEN** it fails with `BAD_USER_INPUT`, and nothing is stored

#### Scenario: Keyless save
- **WHEN** a request without an API key sends `dmbkSoundSaveChimeComposition` while key enforcement is on
- **THEN** it fails with `FORBIDDEN`, and nothing is stored

### Requirement: Duplicate saves
The fingerprint SHALL be a hash of the composition's units in a canonical form, so two saves of identical units produce the same fingerprint. At most one composition SHALL exist per fingerprint. Saving units identical to a stored composition SHALL return that composition with `created: false` and store nothing new. This SHALL hold even when the stored one is hidden: a hidden composition is not re-listed by saving it again.

#### Scenario: Same composition twice
- **WHEN** the same units are saved twice
- **THEN** both responses carry the same composition id, the second has `created: false`, and the collection holds one document

#### Scenario: Moved unit is a new composition
- **WHEN** a composition is saved, then saved again with one unit's `x` changed
- **THEN** a second composition is created

### Requirement: Generated title
The API SHALL generate each composition's title from its units. Client input SHALL never supply any of it. A title SHALL be at most 40 characters, in upper case, and made only from:
- an ensemble word for the unit count (SOLO, DUO, TRIO, QUARTET, QUINTET, SEXTET, SEPTET, OCTET, or `<n> CHIMES` above eight);
- a key, made of a unit's root as a note name without octave (sharps, for example `C#`) and its scale name;
- an instrument, which is a unit's voice display name without parenthesised parts, version tags or the font's `TB` tag, or TUBULAR BELLS for the default voice;
- the joining words IN and FOR.

When the units differ in key or instrument, the title SHALL sample among them. The choice of unit, word order and template SHALL be drawn from the fingerprint, so a composition always gets the same title, and different compositions with the same ingredients can read differently. A title that would exceed 40 characters SHALL drop its ensemble word first, then shorten the instrument to its first word.

#### Scenario: Single chime
- **WHEN** one unit is saved with root 62, scale RYUKYU and the default voice
- **THEN** the title uses only the words SOLO, D, RYUKYU, TUBULAR BELLS, IN and FOR, for example `TUBULAR BELLS SOLO IN D RYUKYU`

#### Scenario: Stable title
- **WHEN** a composition's title is read twice, and its units are saved again
- **THEN** every read and the duplicate save return the same title

#### Scenario: Length cap
- **WHEN** the sampled ingredients would make a title longer than 40 characters
- **THEN** the stored title is at most 40 characters and still names the key

### Requirement: Public listing
`dmbkSoundChimeCompositions(first, after)` SHALL return visible compositions (not hidden), newest first, as a forward-only Relay connection, with no session or key required. `ChimeComposition` SHALL be a Node, so `node(id)` returns a visible composition and returns null for a hidden or missing one, to anyone but an admin. Its fields SHALL be `id`, `title`, `createdAt`, `unitCount` and `units`, and the units SHALL be returned exactly as stored. `hidden` SHALL be exposed to admins only, and resolve to null for everyone else.

#### Scenario: Browse
- **WHEN** an anonymous playground request asks for `dmbkSoundChimeCompositions(first: 20) { edges { node { title unitCount createdAt } } pageInfo { hasNextPage endCursor } }`
- **THEN** it receives up to 20 visible compositions, newest first, with a cursor for the next page

#### Scenario: Hidden composition
- **WHEN** a composition has been hidden
- **THEN** it is missing from the listing, and `node` returns null for its id to non-admins

#### Scenario: Backward paging refused
- **WHEN** a request passes `last` or `before`
- **THEN** it fails with `BAD_USER_INPUT`

### Requirement: Hiding compositions
`dmbkSoundSetChimeCompositionHidden(id, hidden)` SHALL set a composition's `hidden` flag and SHALL be allowed for admins only. Anyone else SHALL be refused with `FORBIDDEN`. Hiding SHALL remove the composition from the public listing at once, and unhiding SHALL restore it. Nothing SHALL delete a composition through the API.

#### Scenario: Admin hides
- **WHEN** an admin hides a composition
- **THEN** the next listing omits it, and the payload reports `hidden: true`

#### Scenario: Non-admin refused
- **WHEN** a signed-in non-admin, or an anonymous client request, tries to hide a composition
- **THEN** it fails with `FORBIDDEN`, and the flag is unchanged

### Requirement: Save rate limits
Saves SHALL be limited per end user. The end user is the IP its client forwards (see `api-access`). The budget SHALL default to 10 saves an hour, refilled evenly. A request with no forwarded IP SHALL share one budget per client. Each client SHALL also have a daily ceiling, defaulting to 500 saves. Both limits SHALL be configurable. Over a limit, the save SHALL fail with `RATE_LIMITED` and a retry time, and store nothing. A save that returns an existing duplicate SHALL count against the budget too.

#### Scenario: Burst from one visitor
- **WHEN** one end-user IP saves 11 different compositions within a minute
- **THEN** the eleventh fails with `RATE_LIMITED`, and the first ten are stored

#### Scenario: Visitors are limited separately
- **WHEN** one end-user IP has exhausted its budget
- **THEN** a save forwarded for another IP still succeeds
