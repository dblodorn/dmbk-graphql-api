# arena-channels Specification

## Purpose
An account's Are.na username, and the schema fields for reading the public Are.na channels it owns or can see through its groups.

## Requirements

### Requirement: An account can save its Are.na username
`arenaSetUser(input: { slug })` SHALL require a signed-in viewer, look the slug up on Are.na, and store the Are.na user's id and slug against the viewer, replacing any previous value. A slug Are.na doesn't know SHALL fail with `NOT_FOUND` and store nothing. `arenaClearUser` SHALL remove the stored user and return `true`, including when none was stored.

#### Scenario: Save a username
- **WHEN** a signed-in viewer calls `arenaSetUser(input: { slug: "some-user" })` for an existing Are.na user
- **THEN** `viewer.arena.user` returns that user's id, slug and name

#### Scenario: Unknown username
- **WHEN** the slug doesn't exist on Are.na
- **THEN** the mutation fails with `NOT_FOUND` and `viewer.arena` is unchanged

#### Scenario: Anonymous caller
- **WHEN** a request with no valid session calls `arenaSetUser`
- **THEN** it fails with `FORBIDDEN` (the `signedIn` scope), like every other signed-in mutation

#### Scenario: Clear
- **WHEN** a viewer with a saved username calls `arenaClearUser`
- **THEN** `viewer.arena` is null

### Requirement: The viewer's public channels, including group channels
`viewer.arena.channels` SHALL list the saved user's own channels, including ones owned by a group, together with the channels of every group the user belongs to. It SHALL de-duplicate them by channel id, order them by last update, newest first, and return them as a Relay connection. The `source` argument SHALL limit the list to `OWN` or `GROUPS` channels.

#### Scenario: Own and group channels
- **WHEN** a viewer whose Are.na user owns a public channel and belongs to a group with a public channel queries `viewer { arena { channels(first: 50) { edges { node { slug owner { isGroup } } } } } }`
- **THEN** both channels are listed, each once

#### Scenario: One group fails
- **WHEN** Are.na fails for one of the user's groups
- **THEN** the list still returns the user's own channels and the other groups' channels

### Requirement: Private channels are never returned
No Are.na field SHALL return a channel whose visibility is `private`, or the contents of one. `arenaChannel` SHALL resolve a private or missing channel to null.

#### Scenario: Private channel filtered
- **WHEN** Are.na returns a channel with `visibility: "private"` in any list or lookup
- **THEN** it doesn't appear in the response

### Requirement: Channel images
`arenaChannel(slug)` SHALL be available to anonymous callers and SHALL return a public or closed channel's image blocks as a Relay connection paginated over Are.na's pages, with each image's original `src`.

#### Scenario: Public channel images
- **WHEN** an anonymous client queries `arenaChannel(slug:) { title images(first: 100) { edges { node { src } } } }` for a public channel
- **THEN** the channel's image blocks resolve with their original URLs

### Requirement: Are.na failures are reported without detail
An Are.na 429 SHALL fail with `RATE_LIMITED`. Any other upstream failure SHALL fail with `UPSTREAM_ERROR`, with the detail logged and not returned.

#### Scenario: Rate limited
- **WHEN** Are.na answers 429
- **THEN** the field fails with `RATE_LIMITED`
