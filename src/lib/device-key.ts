import crypto from 'node:crypto';
import { InvalidInputError } from './cursor.js';

/*
 * The device key a browser makes for itself (32 random bytes as base64url, 43
 * characters) stands in for an account: only its salted hash is stored, so the
 * key never reaches the database. The salt keeps one key's hashes different in
 * each library. The synth libraries keep their own copy in synth-voices/shape.ts.
 */

const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

/** `sha256(salt + ":" + key)`, or `InvalidInputError` for a malformed key. */
export function creatorHash(salt: string, key: string): string {
  if (!DEVICE_KEY.test(key)) throw new InvalidInputError('creatorKey: must be 32 random bytes as base64url (43 characters).');
  return crypto.createHash('sha256').update(`${salt}:${key}`).digest('hex');
}
