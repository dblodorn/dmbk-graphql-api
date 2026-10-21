# Spec Delta

## MODIFIED Requirements

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
- **WHEN** a signed-in account that is not the owner calls `loraTrainerSetTrainingHidden` on a training
- **THEN** the request is refused with `FORBIDDEN`

#### Scenario: Payload node keys unchanged
- **WHEN** a client calls `loraTrainerSetImageHidden`
- **THEN** the payload still exposes the changed node as `generatedImage`

### Requirement: Viewer field names
`Viewer` SHALL expose the signed-in account's own LoRA records as `loraTrainerTrainings` (replacing `loraTrainings`) and `loraTrainerImages` (replacing `generatedImages`), with the same `visibility` argument, default and ownership scoping as before.

#### Scenario: Owner lists own hidden trainings
- **WHEN** a signed-in account queries `viewer { loraTrainerTrainings(first: 10) { edges { node { id hidden } } } }`
- **THEN** it receives its own trainings at any status, hidden ones included

### Requirement: Cross-cutting fields stay unprefixed
Fields that don't belong to a single database SHALL keep their names: `_health`, `node`, `nodes`, `viewer`, `Viewer.id`, `Viewer.email`, `Viewer.name`, `Viewer.isAdmin`, `signInWithGoogle` and `signOut`. Fields that read Are.na rather than one of this API's databases SHALL take an `arena` prefix in the same spirit (`arenaChannel`, `arenaSetUser`, `Viewer.arena`). Node, object and enum type names, and fields nested inside node types (for example `LoraTraining.images`, `GeneratedImage.training`), SHALL NOT be renamed. A connection and edge type built for a renamed field SHALL take its name from the new field (for example `QueryDmbkPhotosConnection`, `ViewerLoraTrainerImagesConnection`).

#### Scenario: Sign-in unchanged
- **WHEN** a client calls `signInWithGoogle(input: { idToken })`
- **THEN** it receives a token and `viewer`, under that unprefixed name

#### Scenario: Existing global IDs still resolve
- **WHEN** a client calls `node(id:)` with a `Photo`, `LoraTraining` or `GeneratedImage` global ID issued before the rename
- **THEN** the same record resolves, because type names did not change
