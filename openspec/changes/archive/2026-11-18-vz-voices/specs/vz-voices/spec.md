## Purpose

How voices made in vz10m (the VZ-10M editor at vz10m.dmbk.io) are saved anonymously to `dmbk-sound.vz_voices`, owned by a device key instead of an account, listed publicly, changed or deleted by their creator, and hidden by an admin when needed.

## ADDED Requirements

### Requirement: Voice storage
Voices SHALL be stored in the `vz_voices` collection of the `dmbk-sound` database, and this API SHALL be its owner and only writer. Each document SHALL hold exactly: `_id` (24 lowercase hex characters, assigned by the API), `schemaVersion` (1), `name` (string, read from the data), `data` (the 336 decoded bytes of a VZ voice, base64, 448 characters), `fingerprint` (SHA-256 of the bytes, 64 lowercase hex), `creatorHash` (64 lowercase hex), `hidden` (boolean), `createdAt` and `updatedAt` (ISO-8601 strings). The collection SHALL carry a strict database-level validator that refuses any other field, type or shape.

#### Scenario: Database refuses an extra field
- **WHEN** any client inserts a document into `vz_voices` with a field not listed above
- **THEN** MongoDB rejects the write and nothing is stored

### Requirement: Data and name
A save or update SHALL accept `data` only when it is exactly 448 base64 characters that decode to 336 bytes; anything else SHALL fail with `BAD_USER_INPUT`. The API SHALL read the voice's name from bytes 322–333, trailing spaces trimmed, and SHALL NOT accept a name from the client.

#### Scenario: Wrong length
- **WHEN** a save sends data that decodes to 335 bytes
- **THEN** it fails with `BAD_USER_INPUT` and nothing is stored

#### Scenario: Name from the bytes
- **WHEN** a save sends a voice whose name bytes spell `KILLER ORGAN`
- **THEN** the stored and returned name is `KILLER ORGAN`

### Requirement: Obscene names refused
A save or update SHALL fail with `BAD_USER_INPUT`, and store nothing, when the voice's name matches the English obscenity set, including look-alike spellings and words spelled out one letter at a time. The message SHALL tell the user to rename the voice. Innocent names containing a matched substring (for example `SCUNTHORPE`, `CLASSIC`) SHALL be accepted.

#### Scenario: Spelled-out word
- **WHEN** a save sends a voice named `F U C K PAD`
- **THEN** it fails with `BAD_USER_INPUT`

### Requirement: Device key ownership
Every save, update and delete SHALL carry a `creatorKey` of 43 base64url characters; a malformed key SHALL fail with `BAD_USER_INPUT`. The API SHALL store only `sha256("vz-creator:" + creatorKey)` and SHALL NOT store or log the key itself. Only the key that saved a voice SHALL update or delete it: another key SHALL get `FORBIDDEN`, and a missing or hidden voice SHALL get `NOT_FOUND`.

#### Scenario: Another device tries to delete
- **WHEN** key B deletes a voice saved by key A
- **THEN** it fails with `FORBIDDEN` and the voice is unchanged

#### Scenario: Creator updates
- **WHEN** key A updates its voice with new data
- **THEN** the data, name and `updatedAt` change, and `createdAt` and the id stay the same

#### Scenario: Creator deletes
- **WHEN** key A deletes its voice
- **THEN** the mutation returns the voice's global id, the document is removed, and `node(id)` resolves to null

### Requirement: Duplicates per key
Saving data that the same key has already saved SHALL return the stored voice with `created: false` and store nothing new. The same data saved by a different key SHALL be stored as a separate voice. Updating a voice to data its key has already saved in another voice SHALL fail with `BAD_USER_INPUT`.

#### Scenario: Same key, same bytes
- **WHEN** key A saves the same data twice
- **THEN** the second save returns the first voice with `created: false`

### Requirement: Public listing
`dmbkSoundVzVoices(first, after)` SHALL list visible voices newest first, forward-only, to anyone. A `creatorKey` argument SHALL narrow it to that key's voices. A `search` argument SHALL narrow it to names containing the text, ignoring case; search text over 12 characters SHALL fail with `BAD_USER_INPUT`. Each voice SHALL expose `yours(creatorKey)`, true only when that key saved it and false for any other or malformed key.

#### Scenario: Marking one's own voices
- **WHEN** a client lists voices and asks `yours(creatorKey: A)` on each
- **THEN** voices saved by key A return true and all others false

### Requirement: Admin hiding
`dmbkSoundSetVzVoiceHidden` SHALL be admin-only. A hidden voice SHALL be left out of the listing, resolve to null through `node(id)` for non-admins, and be treated as missing by its creator's update and delete.

#### Scenario: Member tries to hide
- **WHEN** a signed-in non-admin calls `dmbkSoundSetVzVoiceHidden`
- **THEN** it fails with `FORBIDDEN`

### Requirement: Write access and limits
Save, update and delete SHALL require a client API key, even while key enforcement is off. Each SHALL take from a per-visitor budget (keyed by the client and its `X-End-User-IP`) and a per-client daily budget. Over either limit, the write SHALL fail with `RATE_LIMITED` and a `retryAfterSeconds` extension, and store nothing.

#### Scenario: One visitor writes too often
- **WHEN** one visitor makes more writes in the window than `VZ_WRITE_RATE_LIMIT`
- **THEN** the next write fails with `RATE_LIMITED`, and another visitor can still write
