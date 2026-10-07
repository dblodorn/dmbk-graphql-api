import SchemaBuilder from '@pothos/core';
import RelayPlugin from '@pothos/plugin-relay';
import DataloaderPlugin from '@pothos/plugin-dataloader';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import type { ContextType } from '../context.js';

export const builder = new SchemaBuilder<{
  Context: ContextType;
  DefaultFieldKind: 'regular';
  AuthScopes: {
    public: boolean;
    authenticated: boolean;
    admin: boolean;
  };
}>({
  plugins: [RelayPlugin, DataloaderPlugin, ScopeAuthPlugin],
  relay: {},
  scopeAuth: {
    authorizeOnSubscribe: true,
    authScopes: async (context) => ({
      public: true,
      authenticated: context.isAuthenticated,
      admin: context.currentUser?.role === 'ADMIN',
    }),
  },
});
