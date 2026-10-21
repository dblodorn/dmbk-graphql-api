import mongoose from 'mongoose';
import { env } from '../../env.js';
import { getUser } from './client.js';

/*
 * An account's Are.na username, in `dmbk-accounts.arena_profiles`, one per
 * account. It is a convenience, not a permission: only public data is read
 * with it, so it isn't proved to be the account holder's own.
 */

export interface ArenaProfile {
  userId: string;
  arenaUserId: number;
  arenaSlug: string;
  arenaName: string;
  arenaAvatarUrl: string | null;
  updatedAt: Date;
}

let indexEnsured: Promise<unknown> | null = null;

function collection() {
  const col = mongoose.connection.useDb(env.accountsDbName, { useCache: true }).collection<ArenaProfile>('arena_profiles');
  // `autoIndex` is off globally, so the one index this collection needs is
  // created here, once per process.
  indexEnsured ??= col.createIndex({ userId: 1 }, { unique: true }).catch((error) => {
    indexEnsured = null;
    throw error;
  });
  return { col, ready: indexEnsured };
}

export async function getArenaProfile(userId: string): Promise<ArenaProfile | null> {
  const { col } = collection();
  return col.findOne({ userId }, { projection: { _id: 0 } });
}

/** Look the slug up on Are.na and save it. Throws `ArenaNotFoundError` for an unknown user. */
export async function setArenaProfile(userId: string, slug: string): Promise<ArenaProfile> {
  const user = await getUser(slug.trim().toLowerCase());
  const profile: ArenaProfile = {
    userId,
    arenaUserId: user.id,
    arenaSlug: user.slug,
    arenaName: user.name,
    arenaAvatarUrl: user.avatar ?? null,
    updatedAt: new Date(),
  };
  const { col, ready } = collection();
  await ready;
  await col.replaceOne({ userId }, profile, { upsert: true });
  return profile;
}

export async function clearArenaProfile(userId: string): Promise<void> {
  const { col } = collection();
  await col.deleteOne({ userId });
}
