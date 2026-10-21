# Spec Delta

## MODIFIED Requirements

### Requirement: Database-scoped fields carry the database prefix
Every root Query field, root Mutation field and `Viewer` field that reads or writes a database SHALL begin with that database's name in camelCase: `dmbkPhotos` for `dmbk-photos`, `dmbkSound` for `dmbk-sound` and `loraTrainer` for `lora-trainer`. If the prefix already says a word, the rest of the name SHALL leave it out (`dmbkPhotos`, not `dmbkPhotosPhotos`; `dmbkSoundPlaylists`, not `dmbkSoundSoundPlaylists`; `loraTrainerTrainings`, not `loraTrainerLoraTrainings`). This rule SHALL apply to fields added later as well, including the Phase 2 and Phase 3 fields.

#### Scenario: New field follows the convention
- **WHEN** a root Query, Mutation or `Viewer` field that reads or writes `dmbk-photos`, `dmbk-sound` or `lora-trainer` is added
- **THEN** its name starts with `dmbkPhotos`, `dmbkSound` or `loraTrainer` to match that database

### Requirement: Query field names
The schema SHALL expose these database-scoped root Query fields, with the same arguments, return types, visibility rules and pagination as before:

| Field | Database | Replaces |
|---|---|---|
| `dmbkPhotos` | dmbk-photos | `photos` |
| `dmbkPhotosKeywords` | dmbk-photos | `keywords` |
| `dmbkSoundPlaylists` | dmbk-sound | `dmbkPhotosSoundPlaylists` (earlier `soundPlaylists`) |
| `loraTrainerTrainings` | lora-trainer | `loraTrainings` |

`dmbkPhotosSoundPlaylists` SHALL NOT exist in the schema, and there SHALL be no deprecated alias for it.

#### Scenario: Prefixed photo query
- **WHEN** an anonymous client queries `dmbkPhotos(first: 10) { edges { node { id } } }`
- **THEN** it receives the same ready, visible photos, newest first, that `photos(first: 10)` returned before

#### Scenario: Admin-only filters still refused
- **WHEN** a non-admin queries `dmbkPhotos(visibility: ANY)`
- **THEN** the request fails with code `FORBIDDEN`

#### Scenario: Prefixed LoRA query
- **WHEN** a client queries `loraTrainerTrainings(first: 10)`
- **THEN** it receives completed, non-hidden trainings, newest first, each with its `images` connection

#### Scenario: Sound query under its own database prefix
- **WHEN** a client queries `dmbkSoundPlaylists { fetchedAt }`
- **THEN** it receives the latest snapshot's `fetchedAt`, with the same `SoundSnapshot` type `dmbkPhotosSoundPlaylists` returned

#### Scenario: Old sound query name rejected
- **WHEN** a client queries `{ dmbkPhotosSoundPlaylists { fetchedAt } }`
- **THEN** the request fails validation because `dmbkPhotosSoundPlaylists` is not a field on `Query`
