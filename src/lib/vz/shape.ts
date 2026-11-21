import { voiceShape } from '../synth-voices/shape.js';

/*
 * A saved VZ-1 / VZ-10M voice (openspec/specs/vz-voices): its 336 decoded SysEx data bytes, exactly as vz10m holds
 * and edits them, base64 (448 characters). The name is the 12 ASCII characters at offset 322. The salt keeps the
 * hashes stored before the synth-voices module existed.
 */

export const vzShape = voiceShape({ label: 'VZ', bytes: 336, nameOffset: 322, nameLength: 12, creatorSalt: 'vz-creator' });

export const { VOICE_BYTES, DATA_LENGTH, decodeVoice, voiceName, fingerprint, creatorHash, voiceJsonSchema } = vzShape;
