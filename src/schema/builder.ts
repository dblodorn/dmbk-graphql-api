import SchemaBuilder from '@pothos/core';
import RelayPlugin from '@pothos/plugin-relay';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type { ContextType } from '../context.js';
import { forbidden } from '../errors.js';

export const builder = new SchemaBuilder<{
  Context: ContextType;
  DefaultFieldKind: 'regular';
  // Non-null unless a field opts in, so Relay-generated client types are not
  // `| null` everywhere. Fields that can genuinely be absent say `nullable: true`.
  DefaultFieldNullability: false;
  DefaultEdgesNullability: false;
  DefaultNodeNullability: false;
  AuthScopes: {
    /** Any wallet that completed SIWE. */
    signedIn: boolean;
    /** A wallet in ALLOWED_ADDRESSES — may curate the photo library. */
    admin: boolean;
  };
}>({
  plugins: [ScopeAuthPlugin, RelayPlugin],
  defaultFieldNullability: false,
  relay: {
    clientMutationId: 'optional',
    cursorType: 'String',
    edgesFieldOptions: { nullable: false },
    nodeFieldOptions: { nullable: false },
  },
  scopeAuth: {
    authScopes: async (context) => ({
      signedIn: context.viewer !== null,
      admin: context.viewer?.isAdmin === true,
    }),
    unauthorizedError: () => forbidden('Not authorized.'),
  },
});
