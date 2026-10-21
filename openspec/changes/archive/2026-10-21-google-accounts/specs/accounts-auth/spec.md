# Spec Delta

## Purpose

How people sign in to the dmbk apps, who is admitted and who is an admin, what a signed-in viewer looks like in the schema, and how LoRA records are tied to the account that owns them.

## ADDED Requirements

### Requirement: Google sign-in returns a bearer session
The API SHALL expose `signInWithGoogle(input: { idToken: String! })`, which verifies the Google ID token against `GOOGLE_CLIENT_ID`, creates or finds the account, and returns `{ token, viewer }`. Clients SHALL authenticate later requests with `Authorization: Bearer <token>`. `signOut` SHALL revoke the current session.

#### Scenario: Allowed account signs in
- **WHEN** a client calls `signInWithGoogle` with a valid ID token for a verified email listed in `ALLOWED_EMAILS`
- **THEN** it receives a token, and `viewer` returns that account's `id`, `email` and `name` on requests that send the token

#### Scenario: Revoked session is anonymous
- **WHEN** a client calls `signOut` and then sends the same token
- **THEN** `viewer` is null and public reads still succeed

#### Scenario: Bad token is anonymous, not an error
- **WHEN** a request sends a missing, malformed, expired or revoked bearer token to a public query
- **THEN** the query succeeds as anonymous

### Requirement: Sign-in is limited to an allowlist
Account creation SHALL be refused unless the Google email is verified and listed in `ALLOWED_EMAILS`, compared trimmed and lowercased. An empty or unset `ALLOWED_EMAILS` SHALL admit nobody. A refused sign-in SHALL leave no user, account or session record. An existing account whose email has been removed from `ALLOWED_EMAILS` SHALL resolve as anonymous from its next request.

#### Scenario: Stranger refused without trace
- **WHEN** a verified Google account not on `ALLOWED_EMAILS` calls `signInWithGoogle`
- **THEN** the mutation fails with the same generic `UNAUTHENTICATED` error as any other refused sign-in, and `dmbk-accounts` gains no records

#### Scenario: Unverified email refused
- **WHEN** Google reports the account's email as unverified, even if the address is on `ALLOWED_EMAILS`
- **THEN** sign-in is refused

#### Scenario: Empty allowlist admits nobody
- **WHEN** `ALLOWED_EMAILS` is unset or empty
- **THEN** every sign-in is refused and the server logs that no one can sign in

### Requirement: Admin is derived per request from email
`viewer.isAdmin` SHALL be true only when the viewer's email is in `ADMIN_EMAILS`, evaluated on every request and never stored in the session. Every rule that previously used `ALLOWED_ADDRESSES` SHALL use this instead.

#### Scenario: Removing an admin takes effect immediately
- **WHEN** an email is removed from `ADMIN_EMAILS` and the server restarts
- **THEN** that viewer's next request gets `isAdmin: false` and the public photo scope, without needing to sign in again

### Requirement: Viewer identity fields
`Viewer` SHALL expose `id` (the account's user id), `email`, `name` (nullable) and `isAdmin`. It SHALL NOT expose a wallet address.

#### Scenario: Viewer shape
- **WHEN** a signed-in client queries `viewer { id email name isAdmin }`
- **THEN** every field resolves, and `address` is not in the schema

### Requirement: LoRA records are owned by account
A LoRA training or generated image SHALL be owned by the account whose `id` equals the record's `ownerId`. Every owner-only rule (seeing hidden records, owner-only fields, hide/unhide mutations, `viewer.loraTrainerTrainings` and `viewer.loraTrainerImages`) SHALL use `ownerId`. `walletAddress` SHALL NOT be exposed in the schema.

#### Scenario: Owner sees their hidden training
- **WHEN** the account whose id matches a hidden training's `ownerId` queries it with `node(id:)`
- **THEN** the training resolves, including its owner-only fields

#### Scenario: Another account cannot hide it
- **WHEN** a different signed-in, non-admin account calls `loraTrainerSetTrainingHidden` on that training
- **THEN** the mutation is refused with a forbidden error

### Requirement: No wallet authentication
The schema SHALL NOT contain `siweNonce` or `signInWithEthereum`, and the server SHALL NOT accept SIWE-issued JWTs.

#### Scenario: Old JWT rejected
- **WHEN** a request sends a JWT issued by the removed SIWE flow
- **THEN** the request is treated as anonymous
