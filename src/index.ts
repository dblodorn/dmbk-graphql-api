import { createServer, IncomingMessage } from 'node:http';
import { createYoga, YogaInitialContext } from 'graphql-yoga';
import { builder } from './schema/builder.js';
import { connectDatabase } from './db/mongoose.js';
import { createContext } from './context.js';
import { getUserFromRequest } from './auth.js';

// Import schema types to register them with the builder
import './schema/queries.js';
import './schema/mutations.js';

async function main() {
  await connectDatabase();

  const schema = builder.toSchema();

  const yoga = createYoga({
    schema,
    context: async ({ request }: YogaInitialContext & { request: IncomingMessage }) => {
      const user = getUserFromRequest(request);
      return createContext(user);
    },
    graphiql: {
      title: 'GraphQL API Explorer',
      defaultQuery: `# Welcome to the GraphQL API
#
# Queries:
query Health {
  _health
}
#
# Mutations:
# mutation SignUp {
#   signUp(email: "user@example.com", password: "secret123", name: "User") {
#     id email name role
#   }
# }
`,
    },
    maskedErrors: process.env.NODE_ENV === 'production',
  });

  const server = createServer(yoga);

  const port = parseInt(process.env.PORT || '4000', 10);
  server.listen(port, () => {
    console.log(`GraphQL API running at http://localhost:${port}/graphql`);
  });
}

main().catch(console.error);
