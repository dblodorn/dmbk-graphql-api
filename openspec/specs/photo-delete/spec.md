# photo-delete Specification

## Purpose

Lets an admin permanently remove a photo from the dmbk library through the API: its record, its keyword counts and its stored files. If only part of the delete succeeds, the response says so. Hiding stays the reversible alternative.

## Requirements

### Requirement: Delete is admin-only
`dmbkPhotosDeletePhoto(input: { id })` SHALL require an admin session. Any other caller SHALL be refused, and nothing SHALL change.

#### Scenario: Non-admin refused
- **WHEN** a signed-in non-admin calls `dmbkPhotosDeletePhoto` on a ready photo
- **THEN** the request fails with `FORBIDDEN`, and the photo and its files remain

#### Scenario: Anonymous refused
- **WHEN** a caller with no session calls `dmbkPhotosDeletePhoto`
- **THEN** the request fails with `UNAUTHENTICATED` or `FORBIDDEN`

### Requirement: Deleting a photo
`dmbkPhotosDeletePhoto` SHALL delete a photo at any status (`ready`, `pending` or `failed`) and any visibility. It SHALL:
- remove the photo record;
- if the photo was counted (ready and not hidden), decrement each of its keywords' counts as dmbk does;
- delete the storage objects named by the keys recorded on the photo (original, display, grid, thumb).

Keys that are null or already absent SHALL be skipped without error. The payload SHALL return `deletedPhotoId`, the photo's global ID, usable with Relay `@deleteRecord`.

#### Scenario: Ready photo deleted
- **WHEN** an admin deletes a ready, visible photo with keywords `["baja", "la"]`
- **THEN** the payload's `deletedPhotoId` equals the photo's global ID, `node(id:)` returns null even for an admin, the counts for `baja` and `la` each drop by 1, and its original and derivative objects no longer exist

#### Scenario: Hidden photo deleted
- **WHEN** an admin deletes a hidden ready photo
- **THEN** the record and files are removed, and no keyword count changes

#### Scenario: Pending photo with no upload deleted
- **WHEN** an admin deletes a pending photo whose original was never uploaded
- **THEN** the delete succeeds, and no keyword count changes

#### Scenario: Unknown or malformed id
- **WHEN** an admin deletes an id that doesn't exist, or one that isn't a valid photo id
- **THEN** the request fails with `NOT_FOUND`, and nothing changes

### Requirement: Storage deletes are explicit, never by prefix
A delete SHALL only remove the exact keys recorded on that photo document. It SHALL NOT list or delete by prefix, because the Space is shared with lora-trainer and other apps.

#### Scenario: Unrelated objects untouched
- **WHEN** an admin deletes a photo
- **THEN** no object outside that photo's recorded keys is removed, including other objects under `photos/{id}/`

### Requirement: A delete that only partly succeeds is reported
If the record is removed but deleting its stored objects fails, the request SHALL fail with error code `STORAGE_CLEANUP_FAILED` and a message saying the record was deleted but its files could not be removed. The failure SHALL be logged server-side with the photo id. The record SHALL stay deleted. The API SHALL NOT report a clean delete.

#### Scenario: Storage unavailable during delete
- **WHEN** the record is deleted but the storage delete call errors
- **THEN** the response carries code `STORAGE_CLEANUP_FAILED`, the photo no longer resolves by `node(id:)`, and the server log names the photo id
