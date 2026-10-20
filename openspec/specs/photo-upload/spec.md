# photo-upload Specification

## Purpose

Lets an admin add a photo to the dmbk library through the API. The admin reserves an upload, sends the original straight to storage, then finalizes it into a published photo with generated derivatives. The rules stay identical to dmbk's own upload flow while both apps write.

## Requirements

### Requirement: Uploads are admin-only
`dmbkPhotosReservePhotoUpload` and `dmbkPhotosFinalizePhoto` SHALL require an admin session. Any other caller SHALL be refused, and nothing SHALL be created, stored or changed.

#### Scenario: Anonymous reserve refused
- **WHEN** a caller with no session calls `dmbkPhotosReservePhotoUpload`
- **THEN** the request fails with `UNAUTHENTICATED` or `FORBIDDEN`, and no photo record is created

#### Scenario: Non-admin finalize refused
- **WHEN** a signed-in non-admin calls `dmbkPhotosFinalizePhoto` on a pending photo
- **THEN** the request fails with `FORBIDDEN`, and the photo stays `pending`

### Requirement: Reserving an upload
`dmbkPhotosReservePhotoUpload(input: { contentType, byteSize, title?, keywords? })` SHALL:
- create a photo record with a server-generated UUID, `status: pending`, `hidden: false`, the normalized title and keywords, and `schemaVersion` 3;
- return that photo and an `uploadUrl`.

The `uploadUrl` SHALL be a presigned PUT URL that:
- is valid for 15 minutes;
- is good for exactly one key, `photos/{id}/original.{ext}`, where the extension comes from the declared content type and never from client input;
- is good for exactly that content type;
- stores the object as private.

The caller SHALL NOT be able to choose the id or the key.

#### Scenario: Successful reservation
- **WHEN** an admin reserves with `contentType: "image/jpeg"`, `byteSize: 2000000` and `title: "Baja"`
- **THEN** the payload's `photo` has `status: PENDING` and title `Baja`, and `uploadUrl` accepts a PUT of a JPEG to `photos/<that id>/original.jpg`

#### Scenario: Unsupported content type refused
- **WHEN** an admin reserves with a content type other than `image/jpeg`, `image/png`, `image/webp` or `image/avif`
- **THEN** the request fails with `BAD_USER_INPUT`, and no record is created

#### Scenario: Oversized declaration refused
- **WHEN** an admin reserves with `byteSize` of zero, a negative value, or more than 50 MB (52,428,800 bytes)
- **THEN** the request fails with `BAD_USER_INPUT`, and no record is created

#### Scenario: Pending photo is hidden from the public
- **WHEN** an anonymous caller loads a just-reserved photo by `node(id:)` or lists `dmbkPhotos`
- **THEN** the photo does not appear (null by id), while an admin sees it by id and in `dmbkPhotos(states: [PENDING])`

### Requirement: Keyword labels and counts during upload
Reserving SHALL record the human-readable label of each new keyword, as dmbk does, but SHALL NOT change any keyword count, since a pending photo isn't counted. A photo SHALL add to its keywords' counts only when it becomes `ready` and is not hidden, matching the `isCounted` rule shared with dmbk.

#### Scenario: Counts move only on publish
- **WHEN** an admin reserves a photo with keyword `"New Place"` and later finalizes it
- **THEN** after the reservation `dmbkPhotosKeywords` shows no change to any count, and after finalize `new-place` has count +1 with label `New Place`

### Requirement: Finalizing an upload
`dmbkPhotosFinalizePhoto(input: { id, title?, keywords? })` SHALL:
- accept only a photo that is `pending`;
- check that the original exists in storage;
- decode it and use the decoded format and dimensions, not the declared ones, after applying EXIF orientation;
- reject it unless it is JPEG, PNG, WebP or AVIF and at most 50 MB;
- generate three WebP derivatives within a 400, 1000 and 1600 pixel longest edge (thumb, grid and display), never enlarging, and store them public-read at `photos/{id}/thumb.webp`, `grid.webp` and `display.webp`;
- promote the photo to `ready` with its width, height, byte size, content type and derivative keys.

A `title` or `keywords` supplied at finalize SHALL replace the reserved values, and omitted ones SHALL keep them. The payload SHALL return `photo` and `photoEdge`, an edge for that photo usable with Relay `@prependEdge`.

#### Scenario: Successful finalize
- **WHEN** an admin finalizes a pending photo whose original was uploaded
- **THEN** the payload's `photo` has `status: READY`, non-null `width`/`height`, and `thumbUrl`, `gridUrl` and `displayUrl` that resolve on the CDN, and `photoEdge.node.id` equals `photo.id`

#### Scenario: Portrait orientation honored
- **WHEN** the uploaded JPEG is stored landscape with an EXIF orientation of 6
- **THEN** the finalized photo reports portrait `width`/`height`, and its derivatives are upright

#### Scenario: Not pending
- **WHEN** an admin finalizes a photo that is `ready` or `failed`
- **THEN** the request fails with `BAD_USER_INPUT`, and the photo is unchanged

#### Scenario: Unknown photo
- **WHEN** an admin finalizes an id that doesn't exist
- **THEN** the request fails with `NOT_FOUND`

### Requirement: Failed finalization is recorded, not half-applied
When finalizing a pending photo fails for any reason, the photo SHALL be marked `failed` with a non-empty `failureReason`, and the request SHALL fail. A failed photo SHALL never become `ready` or be counted. The cases are:
- no uploaded object;
- bytes that don't decode;
- an unsupported format;
- the size limit is exceeded;
- a storage or processing error.

#### Scenario: Upload never completed
- **WHEN** an admin finalizes a pending photo but nothing was PUT to its upload URL
- **THEN** the request fails with `BAD_USER_INPUT`, and the photo's `status` is `FAILED` with a `failureReason` saying the upload was never completed

#### Scenario: Not an image
- **WHEN** the bytes PUT to the upload URL are not a decodable image
- **THEN** the request fails with `BAD_USER_INPUT`, and the photo is `FAILED` with a reason

#### Scenario: Original never exposed
- **WHEN** any caller reads a photo at any status
- **THEN** no field exposes the original's storage key or a URL to it
