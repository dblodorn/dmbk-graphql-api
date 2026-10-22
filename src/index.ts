import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { env } from './env.js';
import { builder } from './schema/builder.js';
import { connectDatabase } from './db/mongoose.js';
import { createContext } from './context.js';
import { getViewerFromRequest } from './auth/viewer.js';
import { maskError } from './errors.js';
import { isAllowedOrigin } from './lib/hosts.js';
import { accessFor, useApiAccess } from './lib/api-access/plugin.js';

// Schema files register their types and fields on the shared builder as an
// import side effect; they must be imported before toSchema() runs.
import './schema/queries.js';
import './schema/mutations.js';

async function main() {
  await connectDatabase();

  const schema = builder.toSchema();

  const yoga = createYoga({
    schema,
    // A playground request runs as anonymous whatever its Authorization header
    // says: a session token alone, without a client's key, reaches nothing private.
    context: async ({ request }) => {
      const access = accessFor(request);
      const client = access.kind === 'client' ? access.client : null;
      const viewer = access.kind === 'playground' ? null : await getViewerFromRequest(request);
      return createContext(request, viewer, client);
    },
    plugins: [useApiAccess()],
    graphiql: {
      title: 'dmbk GraphQL API',
      defaultQuery: `query DmbkPhotos {
  dmbkPhotos(first: 5) {
    edges { node { id title thumbUrl } }
    pageInfo { hasNextPage endCursor }
  }
}
`,
    },
    maskedErrors: { maskError, isDev: !env.isProduction },
    // Browsers may call this API only from the sites in ALLOWED_ORIGINS.
    // Auth is a bearer token, not a cookie, so credentials stay off. Requests
    // without an Origin (curl, same-origin GraphiQL) are unaffected. X-API-Key
    // is deliberately not an allowed header: keys live on client servers, and a
    // key pasted into browser code fails its preflight.
    cors: (request) => {
      const origin = request.headers.get('origin');
      if (!origin || !isAllowedOrigin(origin, env.allowedOrigins)) return false;
      // Already checked above: '*' makes Yoga echo this Origin back and add `Vary: Origin`.
      return {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['content-type', 'authorization'],
        credentials: false,
        maxAge: 86400,
      };
    },
  });

  const server = createServer(yoga);

  server.listen(env.port, env.host, () => {
    console.log(`GraphQL API running at http://${env.host}:${env.port}/graphql`);
  });
}

main().catch(console.error);
