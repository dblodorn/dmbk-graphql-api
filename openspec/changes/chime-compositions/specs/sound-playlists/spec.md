## MODIFIED Requirements

### Requirement: Sound data lives in dmbk-sound
The SoundCloud playlists snapshot SHALL be stored in the `sound_snapshots` collection of the `dmbk-sound` database, as the single document `_id: "playlists"`. Its fields are `playlists` (the SoundCloud playlists, stored verbatim), `fetchedAt` (ISO-8601 string) and `schemaVersion`. Ownership of `dmbk-sound` SHALL be per collection. The dmbk app SHALL be the owner and only writer of `sound_snapshots`, and this API SHALL only read it. This API SHALL be the owner and only writer of `chime_compositions` (see `chime-compositions`). The database name SHALL be configurable through `SOUND_DB_NAME`, defaulting to `dmbk-sound`.

#### Scenario: dmbk refreshes the snapshot
- **WHEN** a dmbk build reads SoundCloud successfully
- **THEN** the new snapshot is written to `dmbk-sound.sound_snapshots` and nothing is written to `dmbk-photos`

#### Scenario: dmbk falls back to the snapshot
- **WHEN** a dmbk build cannot reach SoundCloud
- **THEN** it builds `/sound` from the snapshot in `dmbk-sound.sound_snapshots`

#### Scenario: Collections keep their owners
- **WHEN** this API saves a chime composition
- **THEN** it writes only to `dmbk-sound.chime_compositions`, and `sound_snapshots` is untouched
