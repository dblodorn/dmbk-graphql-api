import { createServer } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { env } from './env.js';
import { builder } from './schema/builder.js';
import { connectDatabase } from './db/mongoose.js';
import { createContext } from './context.js';
import { getViewerFromRequest } from './auth/token.js';
import { maskError } from './errors.js';

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
  });

  const server = createServer(yoga);

  server.listen(env.port, () => {
    console.log(`GraphQL API running at http://localhost:${env.port}/graphql`);
  });
}

main().catch(console.error);
