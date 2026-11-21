# Spec Delta

## ADDED Requirements

### Requirement: Synth patch interface
`VzVoice` SHALL implement a GraphQL interface `SynthPatch`, which implements `Node` and has `id`, `name` (the patch's display name) and `data` (the patch bytes as base64). A client SHALL be able to fetch any synth's patch by its global id with `node(id) { ... on SynthPatch { name data } }` without naming the synth's own type. The patch libraries of later synths SHALL implement the same interface. A hidden or missing voice SHALL resolve to null through it, exactly as through `... on VzVoice`.

#### Scenario: Fetch by interface
- **WHEN** a client queries `node(id)` with a visible voice's global id and selects `... on SynthPatch { name data }`
- **THEN** it gets the voice's name and its 448-character base64 data

#### Scenario: Hidden voice
- **WHEN** a non-admin queries a hidden voice's id through `... on SynthPatch`
- **THEN** `node` is null
