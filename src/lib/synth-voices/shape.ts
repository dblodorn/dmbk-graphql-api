import crypto from 'node:crypto';
import { InvalidInputError } from '../cursor.js';

/*
 * What a saved voice is, for any emulated synth: its raw bytes in the synth's own format, stored as base64. The
 * bytes are the source of truth, so anything the synth's editor doesn't model survives, and the API never parses
 * parameters. The name is read from the bytes at the synth's name offset, never taken from client text. Each
 * synth's `lib/<synth>/shape.ts` instantiates this with its format.
 */

export interface VoiceFormat {
  /** The synth as people name it, for messages: "VZ", "DX7". */
  label: string;
  bytes: number;
  nameOffset: number;
  nameLength: number;
  /** Prefixed to the device key before hashing, so one key gives different hashes in different libraries. */
  creatorSalt: string;
}

/** The device key a browser makes for itself: 32 random bytes as base64url. */
const CREATOR_KEY = /^[A-Za-z0-9_-]{43}$/;

export function voiceShape(format: VoiceFormat) {
  const { label, bytes: VOICE_BYTES, nameOffset, nameLength, creatorSalt } = format;
  const DATA_LENGTH = Math.ceil(VOICE_BYTES / 3) * 4;
  const pad = (3 - (VOICE_BYTES % 3)) % 3;
  const dataPattern = `^[A-Za-z0-9+/]{${DATA_LENGTH - pad}}${'='.repeat(pad)}$`;
  const BASE64 = new RegExp(dataPattern);

  /** Decode and check a voice. Throws `InvalidInputError` with the reason. */
  function decodeVoice(data: string): Buffer {
    if (!BASE64.test(data)) throw new InvalidInputError(`data: must be ${VOICE_BYTES} bytes as base64 (${DATA_LENGTH} characters).`);
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length !== VOICE_BYTES) throw new InvalidInputError(`data: must be ${VOICE_BYTES} bytes.`);
    return bytes;
  }

  /** The voice's name as the synth shows it: printable ASCII, trailing spaces trimmed. */
  function voiceName(bytes: Buffer): string {
    return Array.from(bytes.subarray(nameOffset, nameOffset + nameLength), (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ' '))
      .join('')
      .trimEnd();
  }

  /** SHA-256 of the bytes: one creator never holds two identical voices. */
  const fingerprint = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex');

  /** The stored stand-in for a device key. Only this hash is kept, so the key never reaches the database. */
  function creatorHash(key: string): string {
    if (!CREATOR_KEY.test(key)) throw new InvalidInputError('creatorKey: must be 32 random bytes as base64url (43 characters).');
    return crypto.createHash('sha256').update(`${creatorSalt}:${key}`).digest('hex');
  }

  /** The collection's validator: MongoDB refuses what the API would. */
  function voiceJsonSchema(): Record<string, unknown> {
    const iso = { bsonType: 'string', minLength: 20, maxLength: 30 };
    const hex64 = { bsonType: 'string', pattern: '^[0-9a-f]{64}$' };
    return {
      bsonType: 'object',
      additionalProperties: false,
      required: ['_id', 'schemaVersion', 'name', 'data', 'fingerprint', 'creatorHash', 'hidden', 'createdAt', 'updatedAt'],
      properties: {
        _id: { bsonType: 'string', pattern: '^[0-9a-f]{24}$' },
        schemaVersion: { enum: [1] },
        name: { bsonType: 'string', maxLength: nameLength },
        data: { bsonType: 'string', pattern: dataPattern },
        fingerprint: hex64,
        creatorHash: hex64,
        hidden: { bsonType: 'bool' },
        createdAt: iso,
        updatedAt: iso,
      },
    };
  }

  return { label, VOICE_BYTES, DATA_LENGTH, NAME_LENGTH: nameLength, decodeVoice, voiceName, fingerprint, creatorHash, voiceJsonSchema };
}

export type VoiceShape = ReturnType<typeof voiceShape>;
