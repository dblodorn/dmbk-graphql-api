import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../env.js';

/*
 * Per-client API keys, in `dmbk-accounts.api_clients`, one document per key.
 * Only the SHA-256 of a key is stored. A key is 256 random bits, so a slow
 * hash would protect nothing, and a plain one makes the lookup a point read
 * on `_id`. The key id (8 chars after the prefix) is safe to show and is how
 * the operator script names one key of a client.
 */

const PREFIX = 'dmbk_';
const KEY_ID_LENGTH = 8;
/** `lastUsedAt` is refreshed at most this often, not on every request. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface ApiClientKey {
  /** SHA-256 of the key, hex. */
  _id: string;
  keyId: string;
  client: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

let indexEnsured: Promise<unknown> | null = null;

function collection() {
  const col = mongoose.connection.useDb(env.accountsDbName, { useCache: true }).collection<ApiClientKey>('api_clients');
  // `autoIndex` is off globally; the one secondary index (for listings by
  // client) is created here, once per process.
  indexEnsured ??= col.createIndex({ client: 1 }).catch((error) => {
    indexEnsured = null;
    throw error;
  });
  return { col, ready: indexEnsured };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** The client a key belongs to, or null for an unknown or revoked key. */
export async function findActiveKey(key: string): Promise<{ client: string } | null> {
  // Anything not shaped like one of ours can't match; skip the read.
  if (!key.startsWith(PREFIX) || key.length > 128) return null;
  const { col } = collection();
  const doc = await col.findOne({ _id: hashKey(key), revokedAt: null }, { projection: { client: 1, lastUsedAt: 1 } });
  if (!doc) return null;

  if (!doc.lastUsedAt || Date.now() - Date.parse(doc.lastUsedAt) > TOUCH_INTERVAL_MS) {
    col.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date().toISOString() } }).catch((error) => {
      console.error('[api-keys] lastUsedAt update failed', error);
    });
  }
  return { client: doc.client };
}

/** Issue a key. The returned `key` is the only time it exists in full. */
export async function createKey(client: string): Promise<{ key: string; keyId: string }> {
  const key = PREFIX + randomBytes(32).toString('base64url');
  const keyId = key.slice(PREFIX.length, PREFIX.length + KEY_ID_LENGTH);
  const { col, ready } = collection();
  await ready;
  await col.insertOne({
    _id: hashKey(key),
    keyId,
    client,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    lastUsedAt: null,
  });
  return { key, keyId };
}

/** Every key, without its hash. */
export async function listKeys(): Promise<Omit<ApiClientKey, '_id'>[]> {
  const { col } = collection();
  return col.find({}, { projection: { _id: 0 } }).sort({ client: 1, createdAt: 1 }).toArray();
}

/** Revoke one key of a client, or all of its active keys. Returns how many were revoked. */
export async function revokeKeys(client: string, keyId?: string): Promise<number> {
  const { col } = collection();
  const result = await col.updateMany(
    { client, revokedAt: null, ...(keyId ? { keyId } : {}) },
    { $set: { revokedAt: new Date().toISOString() } },
  );
  return result.modifiedCount;
}

/** Remove a client's keys outright. For test fixtures only; operators revoke. */
export async function deleteKeys(client: string): Promise<number> {
  const { col } = collection();
  const result = await col.deleteMany({ client });
  return result.deletedCount;
}
