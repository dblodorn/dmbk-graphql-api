import { builder } from './builder.js';
import mongoose from 'mongoose';
import type { ContextType } from '../context.js';
import { User } from './types/user.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

builder.mutationType({});

builder.mutationField('signUp', (t) =>
  t.field({
    type: User,
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
      name: t.arg.string({ required: true }),
    },
    resolve: async (_root: unknown, args: { email: string; password: string; name: string }) => {
      const existing = await mongoose.model('User').findOne({ email: args.email });
      if (existing) throw new Error('Email already in use');

      const { hash } = await import('bcryptjs');
      const hashedPassword = await hash(args.password, 10);
      const user = await mongoose.model('User').create({
        email: args.email,
        password: hashedPassword,
        name: args.name,
        role: 'USER',
      });

      return {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      };
    },
  }),
);

builder.mutationField('signIn', (t) =>
  t.field({
    type: 'String',
    args: {
      email: t.arg.string({ required: true }),
      password: t.arg.string({ required: true }),
    },
    resolve: async (_root: unknown, args: { email: string; password: string }) => {
      const user = await mongoose.model('User').findOne({ email: args.email });
      if (!user) throw new Error('Invalid credentials');

      const { compare } = await import('bcryptjs');
      const valid = await compare(args.password, user.password);
      if (!valid) throw new Error('Invalid credentials');

      const { default: jwt } = await import('jsonwebtoken');
      return jwt.sign(
        { id: user._id.toString(), email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' },
      );
    },
  }),
);

builder.relayMutationField(
  'updateProfile',
  {
    inputFields: (t) => ({
      name: t.string({ required: true }),
    }),
  },
  {
    resolve: async (_root: unknown, args, context: ContextType) => {
      if (!context.isAuthenticated) throw new Error('Not authenticated');

      const updated = await mongoose.model('User').findByIdAndUpdate(
        context.currentUser!.id,
        { name: (args.input as { name: string }).name },
        { new: true },
      );

      if (!updated) return { user: null };

      return {
        user: {
          id: updated._id.toString(),
          email: updated.email,
          name: updated.name,
          role: updated.role,
        },
      };
    },
  },
  {
    outputFields: (t) => ({
      user: t.field({
        type: User,
        nullable: true,
        resolve: (parent) => parent.user,
      }),
    }),
  },
);
