# Spec Delta

## Purpose

Defines where the cached SoundCloud playlists snapshot lives (`dmbk-sound`, a database just for sound data, kept out of `dmbk-photos`) and how this API serves it.

## ADDED Requirements

### Requirement: Sound data lives in dmbk-sound
The SoundCloud playlists snapshot SHALL be stored in the `sound_snapshots` collection of the `dmbk-sound` database, as the single document `_id: "playlists"`. Its fields are `playlists` (the SoundCloud playlists, stored verbatim), `fetchedAt` (ISO-8601 string) and `schemaVersion`. The dmbk app SHALL be the database's owner and only writer. This API SHALL only read it. The database name SHALL be configurable through `SOUND_DB_NAME`, defaulting to `dmbk-sound`.

#### Scenario: dmbk refreshes the snapshot
- **WHEN** a dmbk build reads SoundCloud successfully
- **THEN** the new snapshot is written to `dmbk-sound.sound_snapshots` and nothing is written to `dmbk-photos`

#### Scenario: dmbk falls back to the snapshot
- **WHEN** a dmbk build cannot reach SoundCloud
- **THEN** it builds `/sound` from the snapshot in `dmbk-sound.sound_snapshots`

### Requirement: dmbk-photos holds no sound data
Once the move is complete, the `dmbk-photos` database SHALL NOT contain a `sound_snapshots` collection, and neither app SHALL read or write sound data there.

#### Scenario: Old collection gone
- **WHEN** the collections of `dmbk-photos` are listed after the move
- **THEN** `sound_snapshots` is not among them

### Requirement: Snapshot move preserves the document
Moving the snapshot from `dmbk-photos` to `dmbk-sound` SHALL keep `_id`, `playlists`, `fetchedAt` and `schemaVersion` byte-for-byte. Running the move again SHALL be safe, and it SHALL NOT replace a newer snapshot (later `fetchedAt`) with an older one. The source collection SHALL only be dropped when explicitly requested, and only while the target holds a copy at least as new as the source.

#### Scenario: Move copies the snapshot
- **WHEN** the move runs with apply while `dmbk-sound` has no snapshot
- **THEN** `dmbk-sound.sound_snapshots` holds a document identical to the one in `dmbk-photos`

#### Scenario: Re-run does not regress
- **WHEN** the move runs again after dmbk has written a newer snapshot to `dmbk-sound`
- **THEN** the newer `dmbk-sound` document is left untouched

#### Scenario: Default run changes nothing
- **WHEN** the move runs without apply
- **THEN** it reports what it would copy or drop and writes nothing

#### Scenario: Drop refused while target is behind
- **WHEN** dropping the source is requested but `dmbk-sound` is missing the snapshot or holds an older one
- **THEN** nothing is dropped and the run fails with an explanation

### Requirement: Playlists query reads dmbk-sound
The `dmbkSoundPlaylists` query SHALL return the snapshot from `dmbk-sound.sound_snapshots` with no authentication required. When no snapshot exists it SHALL return `null`. The returned `SoundSnapshot`, `SoundPlaylist`, `SoundTrack` and `SoundUser` types and their fields SHALL stay the same as before the move.

#### Scenario: Snapshot present
- **WHEN** an anonymous client queries `dmbkSoundPlaylists { fetchedAt playlists { title tracks { title } } }`
- **THEN** it receives the playlists stored in `dmbk-sound.sound_snapshots`

#### Scenario: No snapshot
- **WHEN** `dmbk-sound.sound_snapshots` has no `playlists` document
- **THEN** `dmbkSoundPlaylists` resolves to `null` without an error
