# graphql-schema-naming Specification

## Purpose

Names every GraphQL entry point after the database it reads or writes (`dmbk-photos` or `lora-trainer`), so clients and readers can tell from the schema alone which app's data a field touches.

## Requirements

### Requirement: Database-scoped fields carry the database prefix
Every root Query field, root Mutation field and `Viewer` field that reads or writes a database SHALL begin with that database's name in camelCase: `dmbkPhotos` for `dmbk-photos` and `loraTrainer` for `lora-trainer`. If the prefix already says a word, the rest of the name SHALL leave it out (`dmbkPhotos`, not `dmbkPhotosPhotos`; `loraTrainerTrainings`, not `loraTrainerLoraTrainings`). This rule SHALL apply to fields added later as well, including the Phase 2 and Phase 3 fields.

#### Scenario: New field follows the convention
- **WHEN** a root Query, Mutation or `Viewer` field that reads or writes `dmbk-photos` or `lora-trainer` is added
- **THEN** its name starts with `dmbkPhotos` or `loraTrainer` to match that database

### Requirement: Query field names
The schema SHALL expose these database-scoped root Query fields, with the same arguments, return types, visibility rules and pagination as before:

| Field | Database | Replaces |
|---|---|---|
| `dmbkPhotos` | dmbk-photos | `photos` |
| `dmbkPhotosKeywords` | dmbk-photos | `keywords` |
| `dmbkPhotosSoundPlaylists` | dmbk-photos | `soundPlaylists` |
| `loraTrainerTrainings` | lora-trainer | `loraTrainings` |

#### Scenario: Prefixed photo query
- **WHEN** an anonymous client queries `dmbkPhotos(first: 10) { edges { node { id } } }`
- **THEN** it receives the same ready, visible photos, newest first, that `photos(first: 10)` returned before

#### Scenario: Admin-only filters still refused
- **WHEN** a non-admin queries `dmbkPhotos(visibility: ANY)`
- **THEN** the request fails with code `FORBIDDEN`

#### Scenario: Prefixed LoRA query
- **WHEN** a client queries `loraTrainerTrainings(first: 10)`
- **THEN** it receives completed, non-hidden trainings, newest first, each with its `images` connection

### Requirement: Mutation field names
The schema SHALL expose these database-scoped root Mutation fields as Relay input-object mutations, with the same inputs, payload fields, auth rules and side effects as before. Their input and payload types SHALL be named after the new field (`<FieldInPascalCase>Input` / `<FieldInPascalCase>Payload`).

| Field | Database | Auth | Replaces |
|---|---|---|---|
| `dmbkPhotosUpdatePhoto` | dmbk-photos | admin | `updatePhoto` |
| `dmbkPhotosSetPhotoHidden` | dmbk-photos | admin | `setPhotoHidden` |
| `loraTrainerSetTrainingHidden` | lora-trainer | owner | `setLoraTrainingHidden` |
| `loraTrainerSetImageHidden` | lora-trainer | owner | `setGeneratedImageHidden` |

#### Scenario: Prefixed photo mutation
- **WHEN** an admin calls `dmbkPhotosUpdatePhoto(input: DmbkPhotosUpdatePhotoInput!)` with a new title
- **THEN** the payload's `photo` has the new title, and keyword counts are maintained the same way as before

#### Scenario: Prefixed LoRA mutation keeps owner check
- **WHEN** a signed-in wallet that is not the owner calls `loraTrainerSetTrainingHidden` on a training
- **THEN** the request is refused the same way `setLoraTrainingHidden` refused it

#### Scenario: Payload node keys unchanged
- **WHEN** a client calls `loraTrainerSetImageHidden`
- **THEN** the payload still exposes the changed node as `generatedImage`

### Requirement: Viewer field names
`Viewer` SHALL expose the signed-in wallet's own LoRA records as `loraTrainerTrainings` (replacing `loraTrainings`) and `loraTrainerImages` (replacing `generatedImages`), with the same `visibility` argument, default and ownership scoping as before.

#### Scenario: Owner lists own hidden trainings
- **WHEN** a signed-in wallet queries `viewer { loraTrainerTrainings(first: 10) { edges { node { id hidden } } } }`
- **THEN** it receives its own trainings at any status, hidden ones included

### Requirement: Cross-cutting fields stay unprefixed
Fields that don't belong to a single database SHALL keep their names: `_health`, `node`, `nodes`, `viewer`, `Viewer.address`, `Viewer.isAdmin`, `siweNonce` and `signInWithEthereum`. Node, object and enum type names, and fields nested inside node types (for example `LoraTraining.images`, `GeneratedImage.training`), SHALL NOT be renamed. A connection and edge type built for a renamed field SHALL take its name from the new field (for example `QueryDmbkPhotosConnection`, `ViewerLoraTrainerImagesConnection`).

#### Scenario: Sign-in unchanged
- **WHEN** a client calls `siweNonce` and then `signInWithEthereum(input: { message, signature })`
- **THEN** it receives a token exactly as before

#### Scenario: Existing global IDs still resolve
- **WHEN** a client calls `node(id:)` with a `Photo`, `LoraTraining` or `GeneratedImage` global ID issued before the rename
- **THEN** the same record resolves, because type names did not change

### Requirement: Old names are removed
The previous unprefixed database-scoped field names and their input/payload types SHALL NOT exist in the schema. The schema SHALL NOT include deprecated aliases for them.

#### Scenario: Old query name rejected
- **WHEN** a client queries `{ photos(first: 1) { edges { node { id } } } }`
- **THEN** the request fails validation because `photos` is not a field on `Query`

#### Scenario: Old mutation name rejected
- **WHEN** a client calls `setPhotoHidden(input: ...)`
- **THEN** the request fails validation because `setPhotoHidden` is not a field on `Mutation`
