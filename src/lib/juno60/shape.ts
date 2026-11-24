import { voiceShape } from '../synth-voices/shape.js';

/*
 * A saved Roland Juno-60 patch (openspec/specs/juno60-voices): the 42 bytes the juno60 editor holds and edits, in its
 * own layout (the Juno-60 publishes no data format; `packages/roland-juno60-engine/src/params.ts` in dblodorn/juno60),
 * base64 (56 characters, no padding). The name is the 16 ASCII characters at offset 26.
 */

export const juno60Shape = voiceShape({ label: 'Juno-60', bytes: 42, nameOffset: 26, nameLength: 16, creatorSalt: 'juno60-creator' });

export const { VOICE_BYTES, DATA_LENGTH, decodeVoice, voiceName, fingerprint, creatorHash, voiceJsonSchema } = juno60Shape;
