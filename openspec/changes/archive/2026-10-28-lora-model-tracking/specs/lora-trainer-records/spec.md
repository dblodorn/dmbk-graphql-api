# Spec Delta

## MODIFIED Requirements

### Requirement: Create a pending training
A signed-in account SHALL be able to record a pending training for a fal.ai request with `loraTrainerCreateTraining`. The input is the request id, a trigger word (1–50 characters), steps (100–2000), 1–20 source image URLs, an optional Are.na channel URL and title (title up to 200 characters), and an optional trainer model (the fal.ai endpoint id the training was submitted to). The API SHALL assign the id, set the owner to the caller, the status to pending and `hidden` to false, store the trainer model (`fal-ai/flux-lora-fast-training` when none is given), and return the training. A request id SHALL map to at most one training.

#### Scenario: Owner creates a training
- **WHEN** a signed-in account creates a training for a new request id
- **THEN** the payload holds a pending `LoraTraining` the caller owns, and it is absent from the public `loraTrainerTrainings` list

#### Scenario: Trainer model given
- **WHEN** a training is created with trainer model `fal-ai/z-image-turbo-trainer-v2`
- **THEN** the returned training's `trainerModel` is `fal-ai/z-image-turbo-trainer-v2`

#### Scenario: Trainer model omitted
- **WHEN** a training is created without a trainer model
- **THEN** the returned training's `trainerModel` is `fal-ai/flux-lora-fast-training`

#### Scenario: Signed out
- **WHEN** a request without a session calls `loraTrainerCreateTraining`
- **THEN** it is refused as `UNAUTHENTICATED` and nothing is written

#### Scenario: Duplicate request id
- **WHEN** a training already exists for the given request id
- **THEN** the call is refused as `BAD_USER_INPUT` and the existing record is unchanged

#### Scenario: Input out of range
- **WHEN** the input has 0 or more than 20 image URLs, steps outside 100–2000, a trigger word outside 1–50 characters, or a trainer model that is not a well-formed fal.ai endpoint id
- **THEN** the call is refused as `BAD_USER_INPUT` and nothing is written

### Requirement: Record generated images
A signed-in account SHALL be able to record 1–8 images it generated with one LoRA using `loraTrainerRecordImages`. Every image in the batch is owned by the caller and linked to that LoRA. The LoRA SHALL be completed and visible to the caller (public, or their own). Each image SHALL carry a caller-supplied id (32 lowercase hex characters), a prompt (1–1000 characters), its fal.ai URL, an optional mirror URL, and optional width, height, seed, LoRA scale value and name, and requested generation size. The batch MAY name one generator model (the fal.ai endpoint id that produced it), which SHALL be stored on every image in the batch (`fal-ai/flux-lora` when none is given). The batch SHALL be written all or nothing, and the payload SHALL return the recorded images in input order.

#### Scenario: Record a batch
- **WHEN** a signed-in account records 4 images on a completed, visible LoRA
- **THEN** the 4 images are returned in order, owned by the caller, and appear first in that LoRA's `images`

#### Scenario: Generator model given
- **WHEN** a batch is recorded with generator model `fal-ai/z-image/turbo/lora`
- **THEN** every returned image's `generatorModel` is `fal-ai/z-image/turbo/lora`

#### Scenario: Generator model omitted
- **WHEN** a batch is recorded without a generator model
- **THEN** every returned image's `generatorModel` is `fal-ai/flux-lora`

#### Scenario: Malformed generator model
- **WHEN** the generator model is not a well-formed fal.ai endpoint id
- **THEN** the call is refused as `BAD_USER_INPUT` and none of the batch is written

#### Scenario: LoRA not completed or not visible
- **WHEN** the LoRA is pending, or hidden and not the caller's, or doesn't exist
- **THEN** the call is refused as `NOT_FOUND` for a LoRA the caller can't see, or `BAD_USER_INPUT` for their own LoRA that isn't completed, and nothing is written

#### Scenario: Id collision or malformed id
- **WHEN** any image id is malformed, repeated in the batch, or already used
- **THEN** the call is refused as `BAD_USER_INPUT` and none of the batch is written

## ADDED Requirements

### Requirement: Model on every record
Every `LoraTraining` SHALL expose a non-null `trainerModel` and every `GeneratedImage` a non-null `generatorModel`, readable by anyone who can see the record. A record stored without the field SHALL read as the model lora-trainer used before models could be chosen: `fal-ai/flux-lora-fast-training` for trainings and `fal-ai/flux-lora` for images. A well-formed model id is 1–100 characters made of two or more `/`-separated segments of lowercase letters, digits, `-` and `.`, each starting with a letter or digit. The API SHALL NOT restrict which well-formed ids are accepted.

#### Scenario: Record from before this change
- **WHEN** a training and an image written before models were recorded are read
- **THEN** the training's `trainerModel` is `fal-ai/flux-lora-fast-training` and the image's `generatorModel` is `fal-ai/flux-lora`

#### Scenario: Unlisted but well-formed model
- **WHEN** a training is created with trainer model `fal-ai/some-future-trainer/v3`
- **THEN** it is accepted and reads back unchanged

#### Scenario: Public read
- **WHEN** a keyed request with no session reads a public training and its images
- **THEN** `trainerModel` and each image's `generatorModel` are returned
