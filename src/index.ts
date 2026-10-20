import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { env } from './env.js';
import { builder } from './schema/builder.js';
import { connectDatabase } from './db/mongoose.js';
import { createContext } from './context.js';
import { getViewerFromRequest } from './auth/token.js';
import { maskError } from './errors.js';
import { isAllowedOrigin } from './lib/hosts.js';

// Schema files register their types and fields on the shared builder as an
// import side effect; they must be imported before toSchema() runs.
import './schema/queries.js';
import './schema/mutations.js';

async function main() {
  await connectDatabase();

  const schema = builder.toSchema();

  const yoga = createYoga({
    schema,
    context: ({ request }) => createContext(getViewerFromRequest(request)),
    graphiql: {
      title: 'dmbk GraphQL API',
      defaultQuery: `query Photos {
  photos(first: 5) {
    edges { node { id title thumbUrl } }
    pageInfo { hasNextPage endCursor }
  }
}
`,
    },
    maskedErrors: { maskError, isDev: !env.isProduction },
    // Browsers may call this API only from the sites users sign in from.
    // Auth is a bearer token, not a cookie, so credentials stay off. Requests
    // without an Origin (curl, same-origin GraphiQL) are unaffected.
    cors: (request) => {
      const origin = request.headers.get('origin');
      if (!origin || !isAllowedOrigin(origin, env.siweDomains)) return false;
      // Already checked above: '*' makes Yoga echo this Origin back and add `Vary: Origin`.
      return { origin: '*', methods: ['GET', 'POST', 'OPTIONS'], credentials: false, maxAge: 86400 };
    },
  });

  const server = createServer(yoga);

  server.listen(env.port, () => {
    console.log(`GraphQL API running at http://localhost:${env.port}/graphql`);
  });
}

main().catch(console.error);
