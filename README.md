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
MONGODB_URI=mongodb+srv://user:password@cluster.xxxxx.mongodb.net/graphql-api
MONGODB_DB_NAME=graphql-api
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

### Queries

| Field | Auth | Description |
|-------|------|-------------|
| `_health` | none | Health check. Returns `"ok"`. |
| `me` | JWT | Returns the authenticated user. |
| `users` | JWT | Lists all users. |

### Mutations

| Field | Auth | Type | Description |
|-------|------|------|-------------|
| `signUp` | none | Standard | Create a new user account. |
| `signIn` | none | Standard | Authenticate and receive a JWT. |
| `updateProfile` | JWT | Relay | Update the authenticated user's name. |

### Relay Compatibility

The API implements the [Relay Server Specification](https://relay.dev/docs/guides/graphql-server-specification/):

- **Global Object Identification**: The `Node` interface with `node(id: ID!)` root field for refetching objects. All identifiable types use globally unique IDs.
- **Cursor Connections**: Paginated collections use the `Connection`/`Edge` pattern with `first`, `after`, `last`, `before` arguments and `PageInfo` with `hasNextPage`/`hasPreviousPage`.
- **Relay Mutations**: Mutations accept a single `input` argument and return a typed payload, following the Relay input object mutation convention.
- **Input Coercion**: All IDs exposed through the API are opaque global IDs, base64-encoded as `TypeName:LocalID`.

### Authentication

Include the JWT in the `Authorization` header:

```
Authorization: Bearer <token>
```

Unauthenticated requests can only access `_health`, `signUp`, and `signIn`. All other fields require a valid token.

## Project Structure

```
src/
├── index.ts              # Server entry point
├── context.ts            # GraphQL context factory (currentUser, DataLoader, DB)
├── auth.ts               # JWT verification from request headers
├── db/
│   └── mongoose.ts       # MongoDB connection
├── models/
│   └── User.ts           # Mongoose User model (email, password, name, role)
└── schema/
    ├── builder.ts        # Pothos SchemaBuilder with plugins
    ├── queries.ts        # Query type definitions
    ├── mutations.ts      # Mutation type definitions
    └── types/
        └── user.ts       # User GraphQL object type
```

## Adding a New Type

1. Define a Mongoose model in `src/models/`
2. Create a Pothos object ref and implement it in `src/schema/types/`
3. Add query/mutation resolvers in `src/schema/queries.ts` or `src/schema/mutations.ts`

## Deployment

### DigitalOcean Droplet (existing setup)

The API already runs at `graphql.dmbk.network` with Caddy handling TLS. To deploy updates:

```bash
# SSH into the droplet
ssh root@<droplet-ip>

# Pull latest code
cd /opt/graphql-api
git pull

# Restart
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