# lora-trainer-records Specification

## Purpose
How LoRA training records and generated-image records in the `lora-trainer` database are written through this API by the app that runs the fal.ai work. Also covers who may write them, what they may contain, and the public slideshow read built from them.

## Requirements

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

### Requirement: Attach a training's assets
The owner of a training SHALL be able to set its training zip URL and its mirrored source image URLs with `loraTrainerSetTrainingAssets`. Either one may be given alone. A field that is not given SHALL be left unchanged. Anyone else SHALL be refused, and a non-owner SHALL NOT be able to tell a training they can't see from a missing one.

#### Scenario: Owner attaches mirrors
- **WHEN** the owner sets the zip URL and 12 mirrored image URLs on their pending training
- **THEN** the returned training lists the mirrored URLs as `trainingImageUrls`, and `trainingZipUrl` reads back for the owner

#### Scenario: Non-owner, training not visible to them
- **WHEN** an account that isn't the owner targets someone else's pending training
- **THEN** the call is refused as `NOT_FOUND`

#### Scenario: Non-owner, public training
- **WHEN** an account that isn't the owner targets a completed, visible training
- **THEN** the call is refused as `FORBIDDEN` and the training is unchanged

### Requirement: Complete a training
The owner SHALL be able to mark their training completed with `loraTrainerCompleteTraining`, giving the weights URL and optionally the mirrored source image URLs. Completion SHALL set the status to completed and store the weights URL. Mirrored URLs, when given, SHALL replace the stored ones. Completing a training that is already completed SHALL succeed and change nothing. The ownership and visibility refusals SHALL match `loraTrainerSetTrainingAssets`.

#### Scenario: Owner completes
- **WHEN** the owner completes their pending training with a weights URL
- **THEN** it reads back as `COMPLETED` with that `loraWeightsUrl`, and it appears in the public `loraTrainerTrainings` list unless hidden

#### Scenario: Repeat completion
- **WHEN** the owner completes a training that is already completed, with a different weights URL
- **THEN** the call succeeds and the stored weights URL is the original one

#### Scenario: Non-owner
- **WHEN** an account completes a training it doesn't own
- **THEN** the call is refused, as `NOT_FOUND` or `FORBIDDEN` following the visibility rule, and the training is unchanged

### Requirement: Look up one's own training by request id
`Viewer.loraTrainerTrainingByRequestId(requestId)` SHALL return the viewer's own training for that fal.ai request id, at any status or visibility, or null when the viewer has none for it. It SHALL return null, not an error, for a training owned by someone else.

#### Scenario: Own pending training
- **WHEN** the owner looks up the request id of their pending training
- **THEN** that training is returned

#### Scenario: Someone else's training
- **WHEN** an account looks up a request id whose training it doesn't own
- **THEN** the field is null

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

### Requirement: URL rules on writes
Every URL these mutations accept SHALL be an absolute `https` URL. Fields that hold Spaces mirrors SHALL be under `DO_SPACES_CDN_URL` + `/lora-trainer/`. These are `trainingZipUrl`, the mirrored source image URLs and an image's mirror URL. A write that breaks either rule SHALL be refused as `BAD_USER_INPUT` and SHALL write nothing.

#### Scenario: Non-https source
- **WHEN** a training is created with an `http://` image URL
- **THEN** it is refused and nothing is written

#### Scenario: Mirror on another host
- **WHEN** an image's mirror URL is on a host other than the Spaces CDN, or outside `lora-trainer/`
- **THEN** the batch is refused and nothing is written

### Requirement: Public slideshow
`loraTrainerSlideshowImages(count)` SHALL return up to `count` (1–20, default 10) distinct image URLs in random order. They are drawn from visible generated images whose LoRA is completed and visible, and from the source images of completed, visible trainings, preferring Spaces mirrors where they exist. Hidden images, hidden trainings and unfinished trainings SHALL never contribute. Anyone, signed in or not, SHALL be able to read it.

#### Scenario: Hidden records left out
- **WHEN** an image or the training it belongs to is hidden
- **THEN** none of that image's or training's URLs appear in any slideshow response

#### Scenario: Anonymous read
- **WHEN** a keyed request with no session asks for 10 images
- **THEN** up to 10 distinct URLs are returned

#### Scenario: Count out of range
- **WHEN** `count` is 0 or above 20
- **THEN** the query is refused as `BAD_USER_INPUT`

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
