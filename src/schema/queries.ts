import { builder } from './builder.js';
import mongoose from 'mongoose';
import type { ContextType } from '../context.js';
import { User } from './types/user.js';

builder.queryType({});

builder.queryField('_health', (t) =>
  t.string({
    resolve: () => 'ok',
  }),
);

builder.queryField('me', (t) =>
  t.field({
    type: User,
    nullable: true,
    resolve: (_root: unknown, _args: unknown, context: ContextType) => {
      return context.currentUser;
    },
  }),
);

builder.queryField('users', (t) =>
  t.field({
    type: [User],
    resolve: async (_root: unknown, _args: unknown, context: ContextType) => {
      const docs = await context.db.model('User').find().lean().exec() as any[];
      return docs.map((u: any) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.name,
        role: u.role || 'USER',
      }));
    },
  }),
);
