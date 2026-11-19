# Spec Delta

## MODIFIED Requirements

### Requirement: Viewer identity fields
`Viewer` SHALL expose `id` (the account's user id), `email`, `name` (nullable), `image` (nullable: the account's profile picture URL as stored at sign-up, or null when there is none) and `isAdmin`. It SHALL NOT expose a wallet address.

#### Scenario: Viewer shape
- **WHEN** a signed-in client queries `viewer { id email name image isAdmin }`
- **THEN** every field resolves, and `address` is not in the schema

#### Scenario: Account without a picture
- **WHEN** a signed-in account has no stored picture
- **THEN** `image` is null and the other fields resolve as usual
