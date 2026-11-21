import { voiceShape } from '../synth-voices/shape.js';

/*
 * A saved Yamaha DX7 voice (openspec/specs/dx7-voices): the 155 unpacked VCED bytes, exactly as the dx7 editor
 * holds and edits them (OP6 first, the DX7 Operating Manual's parameter order, pp.30–31), base64 (208 characters,
 * one `=`). The name is the 10 ASCII characters at offset 145.
 */

export const dx7Shape = voiceShape({ label: 'DX7', bytes: 155, nameOffset: 145, nameLength: 10, creatorSalt: 'dx7-creator' });

export const { VOICE_BYTES, DATA_LENGTH, decodeVoice, voiceName, fingerprint, creatorHash, voiceJsonSchema } = dx7Shape;
