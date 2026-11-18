import crypto from 'node:crypto';
import { InvalidInputError } from '../cursor.js';

/*
 * The one definition of a saved VZ-1 / VZ-10M voice (openspec/specs/vz-voices).
 * A voice is its 336 decoded SysEx data bytes, exactly as vz10m holds and edits
 * them, stored as base64: the bytes are the source of truth, so anything the
 * editor doesn't model survives. The name is read from the bytes (12 ASCII
 * characters at offset 322), never taken from separate client text.
 */

export const VOICE_BYTES = 336;
const NAME_OFFSET = 322;
const NAME_LENGTH = 12;
/** base64 of 336 bytes: 448 characters, no padding needed. */
export const DATA_LENGTH = 448;
const BASE64 = /^[A-Za-z0-9+/]{448}$/;

/** The device key a browser makes for itself: 32 random bytes as base64url. */
const CREATOR_KEY = /^[A-Za-z0-9_-]{43}$/;

/** Decode and check a voice. Throws `InvalidInputError` with the reason. */
export function decodeVoice(data: string): Buffer {
  if (!BASE64.test(data)) throw new InvalidInputError(`data: must be ${VOICE_BYTES} bytes as base64 (${DATA_LENGTH} characters).`);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length !== VOICE_BYTES) throw new InvalidInputError(`data: must be ${VOICE_BYTES} bytes.`);
  return bytes;
}

/** The voice's name as the VZ shows it: printable ASCII, trailing spaces trimmed. */
export function voiceName(bytes: Buffer): string {
  return Array.from(bytes.subarray(NAME_OFFSET, NAME_OFFSET + NAME_LENGTH), (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ' '))
    .join('')
    .trimEnd();
}

/** SHA-256 of the bytes: one creator never holds two identical voices. */
export const fingerprint = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex');

/**
 * The stored stand-in for a device key. Only this hash is kept, so the key
 * itself never reaches the database and can't be read back from it.
 */
export function creatorHash(key: string): string {
  if (!CREATOR_KEY.test(key)) throw new InvalidInputError('creatorKey: must be 32 random bytes as base64url (43 characters).');
  return crypto.createHash('sha256').update(`vz-creator:${key}`).digest('hex');
}

/** The collection's validator (`scripts/vz-voices-collection.ts`): MongoDB refuses what the API would. */
export function voiceJsonSchema(): Record<string, unknown> {
  const iso = { bsonType: 'string', minLength: 20, maxLength: 30 };
  const hex64 = { bsonType: 'string', pattern: '^[0-9a-f]{64}$' };
  return {
    bsonType: 'object',
    additionalProperties: false,
    required: ['_id', 'schemaVersion', 'name', 'data', 'fingerprint', 'creatorHash', 'hidden', 'createdAt', 'updatedAt'],
    properties: {
      _id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
      schemaVersion: { enum: [1] },
      name: { bsonType: 'string', maxLength: NAME_LENGTH },
      data: { bsonType: 'string', pattern: `^[A-Za-z0-9+/]{${DATA_LENGTH}}$` },
      fingerprint: hex64,
      creatorHash: hex64,
      hidden: { bsonType: 'bool' },
      createdAt: iso,
      updatedAt: iso,
    },
  };
}
