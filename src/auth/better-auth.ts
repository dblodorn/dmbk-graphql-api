import mongoose from 'mongoose';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { bearer } from 'better-auth/plugins';
import { env } from '../env.js';
import { isAllowedEmail } from './allowlist.js';

/*
 * Accounts, owned by this API: better-auth on the `dmbk-accounts` database,
 * Google as the only provider, and the `bearer` plugin so a session travels as
 * `Authorization: Bearer <token>` rather than a cookie. The apps live on other
 * registrable domains (dmbk.io, arenatrainer.dmbk.io, …), where a cookie set by
 * this API would be a third-party cookie.
 *
 * better-auth's HTTP routes are deliberately not mounted. Sign-in is an ID-token
 * exchange (`signInWithGoogle`), session lookup happens in the GraphQL context,
 * and sign-out is a mutation — all through `auth.api` on the server. Nothing
 * else better-auth can do is reachable from outside.
 *
 * Built lazily, after `connectDatabase()`, because the adapter needs the live
 * Mongoose client. It shares that client's pool; better-auth creates its own
 * collections and indexes in `dmbk-accounts`, which no other app writes.
 */

function createAuth() {
  const client = mongoose.connection.getClient();

  return betterAuth({
    secret: env.authSecret,
    baseURL: env.authUrl,
    database: mongodbAdapter(client.db(env.accountsDbName), { client }),
    telemetry: { enabled: false },

    /* Google only: no email and password, so no mail, resets or SMTP. */
    socialProviders: {
      google: { clientId: env.googleClientId, clientSecret: env.googleClientSecret },
    },

    /* Signed tokens only — an unsigned session id is never accepted as a bearer. */
    plugins: [bearer({ requireSignature: true })],

    databaseHooks: {
      user: {
        create: {
          /*
           * The gate on sign-up. Without it every Google account in the world
           * would get a user on first sign-in. Refusing here leaves no user,
           * account or session behind. It only runs when a user is created,
           * so someone later removed from the list is handled by the
           * per-request check in `viewer.ts` instead.
           */
          before: async (user) => {
            // Google can return an address it hasn't confirmed; matching that
            // against the allowlist would admit whoever holds it.
            if (!user.email || user.emailVerified !== true) {
              console.warn('[auth] refused sign-in: no email, or one Google reports as unverified');
              return false;
            }
            if (!isAllowedEmail(user.email)) {
              console.warn('[auth] refused sign-in for an address not on ALLOWED_EMAILS');
              return false;
            }
            return { data: user };
          },
        },
      },
    },
  });
}

let auth: ReturnType<typeof createAuth> | null = null;

/** The configured instance. Built on first use, never at module scope. */
export function getAuth() {
  if (!auth) auth = createAuth();
  return auth;
}
