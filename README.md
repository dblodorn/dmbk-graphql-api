# GraphQL API

A Relay-compatible GraphQL API built with **Pothos GraphQL**, **GraphQL Yoga**, and **MongoDB**. Designed for personal projects with small throughput — lightweight, cache-efficient, and deploy-friendly.

## Architecture

```
Client (Relay) → graphql.dmbk.network:443
                 │ Caddy (TLS termination, reverse proxy)
                 │
                 ↓ localhost:4000
                 GraphQL Yoga
                  ├── GraphiQL explorer at /graphql
                  ├── Envelop plugins (auth)
                  └── Pothos schema builder
                       ├── @pothos/plugin-relay (Node, connections, global IDs)
                       ├── @pothos/plugin-dataloader (per-request batching/caching)
                       └── @pothos/plugin-scope-auth (field/type auth gates)
                            ↓
                       Resolvers → DataLoader (N+1 prevention)
                            ↓
                       MongoDB (Mongoose)
```

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Schema | **Pothos GraphQL** | Code-first, best-in-class TypeScript inference. No code generation. Plugin ecosystem covers Relay, DataLoader, and auth. |
| Server | **GraphQL Yoga** | Zero-config GraphiQL, Envelop plugin system, runs with stdlib `http.createServer`. |
| Database | **MongoDB** (Mongoose) | Flexible schema, Atlas free tier for small projects, well-typed with TypeScript. |
| Batching | **DataLoader** (per-request cache) | Eliminates N+1 within a single query. No Redis needed for small throughput. |
| Caching | **mongoose-plugin-cache** (optional) | Redis-backed cache-through layer for hot models. Not installed by default — add when needed. |
| Auth | **JWT** + **@pothos/plugin-scope-auth** | Token-based. Field-level and type-level auth scopes. |
| Proxy | **Caddy** | Auto TLS, effortless reverse proxy config. |
| Deploy | **PM2** | Process management, auto-restart on crash. |

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB Atlas free tier cluster (or any MongoDB instance)
- A domain pointing to your server (or localhost for development)

### Installation

```bash
git clone https://github.com/dblodorn/graphql-api.git
cd graphql-api
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
PORT=4000
NODE_ENV=development
JWT_SECRET=your-random-secret-here
# The dmbk-world cluster. The database is chosen per collection (below), not by this URI.
MONGODB_URI=mongodb+srv://user:password@cluster.xxxxx.mongodb.net/
PHOTOS_DB_NAME=dmbk-photos      # default
LORA_DB_NAME=lora-trainer       # default
# Public base for photo derivatives — same value as the dmbk app's DO_SPACES_CDN_URL
DO_SPACES_CDN_URL=https://...
# Wallets allowed to curate photos (comma-separated)
ALLOWED_ADDRESSES=0x...
# Hosts users sign in from; a SIWE message naming any other domain is rejected
SIWE_DOMAINS=dmbk.io,localhost:3000
```

### Development

```bash
npm run dev
```

The server starts with hot-reload via `tsx watch`. Open **http://localhost:4000/graphql** for the GraphiQL explorer.

### Production

```bash
npm run start
```

Or use PM2 (recommended for droplet deployments):

```bash
pm2 start ecosystem.config.cjs
```

## API

The API serves content owned by two other apps on the same Atlas cluster: the photo library, keyword vocabulary and SoundCloud snapshot from `dmbk-photos` ([dmbk](https://github.com/dblodorn/dmbk)), and LoRA trainings and generated images from `lora-trainer` ([lora-trainer](https://github.com/dblodorn/lora-trainer)).

### Queries

| Field | Auth | Description |
|-------|------|-------------|
| `_health` | none | Health check. Returns `"ok"`. |
| `node` / `nodes` | none | Refetch any `Photo`, `LoraTraining` or `GeneratedImage` by global ID. |
| `photos` | none (admin for `visibility`/`states`) | Ready, visible photos, newest first; filter by `keywords`. |
| `keywords` | none | Photo keyword vocabulary with counts. |
| `loraTrainings` | none | Completed, visible LoRA trainings; each has an `images` connection. |
| `soundPlaylists` | none | Latest cached SoundCloud playlists. |
| `viewer` | JWT | The signed-in wallet, with its own `loraTrainings` and `generatedImages` (including hidden). |

### Mutations

| Field | Auth | Type | Description |
|-------|------|------|-------------|
| `siweNonce` | none | Standard | Single-use nonce for a SIWE message. |
| `signInWithEthereum` | none | Relay | Verify a signed SIWE message; returns a 7-day JWT. |
| `updatePhoto` | admin | Relay | Replace a photo's title and/or keywords. |
| `setPhotoHidden` | admin | Relay | Hide or unhide a photo. |
| `setLoraTrainingHidden` | owner | Relay | Hide or unhide one of your LoRA trainings. |
| `setGeneratedImageHidden` | owner | Relay | Hide or unhide an image you generated. |

Admin = a wallet in `ALLOWED_ADDRESSES`. Owner = the wallet stored on the record.

### Relay Compatibility

The API implements the [Relay Server Specification](https://relay.dev/docs/guides/graphql-server-specification/):

- **Global Object Identification**: The `Node` interface with `node(id: ID!)` root field for refetching objects. All identifiable types use globally unique IDs.
- **Cursor Connections**: Paginated collections use the `Connection`/`Edge` pattern with `first`, `after`, `last`, `before` arguments and `PageInfo` with `hasNextPage`/`hasPreviousPage`.
- **Relay Mutations**: Mutations accept a single `input` argument and return a typed payload, following the Relay input object mutation convention.
- **Input Coercion**: All IDs exposed through the API are opaque global IDs, base64-encoded as `TypeName:LocalID`.

### Authentication

Sign in with Ethereum (EIP-4361):

1. `mutation { siweNonce }`
2. Have the wallet sign a SIWE message containing that nonce, with `domain` set to the site the user is on (must be listed in `SIWE_DOMAINS`).
3. `signInWithEthereum(input: { message, signature })` returns a token.

Then include it in the `Authorization` header:

```
Authorization: Bearer <token>
```

Reads are public. Hidden or unfinished records are only visible to admins (photos) or their owners (LoRA records); to everyone else they look nonexistent.

## Project Structure

```
src/
├── index.ts              # Server entry point
├── env.ts                # Validated configuration
├── errors.ts             # Domain error → GraphQL error code mapping
├── context.ts            # Per-request viewer + visibility-scoped DataLoaders
├── auth/                 # SIWE verification, JWT issue/verify
├── db/mongoose.ts        # One connection, a handle per database
├── models/               # Mongoose schemas mirroring the owning apps' documents
├── lib/                  # Repositories: every query, write and visibility rule
└── schema/
    ├── builder.ts        # Pothos SchemaBuilder (Relay + scope-auth)
    ├── queries.ts        # Query fields
    ├── mutations.ts      # Relay mutations
    └── types/            # Photo, Keyword, LoraTraining, GeneratedImage, Sound*, Viewer
```

## Adding a New Type

1. Define a Mongoose model in `src/models/` that matches the stored documents exactly (explicit `collection`, `versionKey: false`, string `_id` where the data uses one)
2. Put its queries and visibility rules in a repository under `src/lib/`
3. Create a Pothos ref in `src/schema/types/` — `builder.node` if clients should refetch it by ID
4. Add query/mutation fields in `src/schema/queries.ts` or `src/schema/mutations.ts`

## Deployment

### CI/CD — GitHub Actions (Automated Deploys)

A deploy workflow is included at `.github/workflows/deploy.yml`. On every push to `main`, it SSHes into the droplet, pulls the latest code, installs production deps, and restarts PM2.

**To enable it, add these secrets to your GitHub repo** (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `DROPLET_HOST` | `209.38.147.18` (or your droplet IP) |
| `DROPLET_USER` | `root` |
| `DROPLET_SSH_KEY` | The SSH private key that matches a public key on the droplet |

To get the SSH key for the droplet:
```bash
# From your local machine or the droplet itself, generate a deploy key
ssh-keygen -t ed25519 -C "deploy@graphql-api" -f ~/.ssh/deploy-key -N ""

# Copy the public key to the droplet
ssh-copy-id -i ~/.ssh/deploy-key.pub root@209.38.147.18

# Copy the private key (the whole file) into the DROPLET_SSH_KEY secret
cat ~/.ssh/deploy-key
```

### DigitalOcean Droplet (manual)

```bash
ssh root@<droplet-ip>
cd /opt/graphql-api
git pull
npm install --omit=dev
pm2 restart graphql-api
```

### From Scratch

1. Create a $6–$12/mo Ubuntu droplet
2. Install Node.js 20, Caddy, PM2
3. Clone the repo, install dependencies, configure `.env`
4. Set up Caddy as a reverse proxy to port 4000
5. Start with `pm2 start ecosystem.config.cjs`

## Add-ons (when needed)

- **Redis caching**: Add `mongoose-plugin-cache` + `redis` for cross-request caching of hot models
- **Rate limiting**: Add `@graphql-yoga/plugin-rate-limiter` — anonymous users get a lower limit, authenticated users a higher one
- **Apollo Federation**: Add `@pothos/plugin-federation` to compose into a supergraph
- **Subscriptions**: GraphQL Yoga supports SSE subscriptions out of the box — add a PubSub implementation