import { synthVoiceModel, type SynthVoiceDoc } from './synth-voice.js';

/*
 * Saved Yamaha DX7 voices in `dmbk-sound.dx7_voices` (openspec/specs/dx7-voices): the 155 unpacked VCED voice
 * bytes, base64. The shape is every synth's (`models/synth-voice.ts`).
 */

export type Dx7VoiceDoc = SynthVoiceDoc;

export const Dx7VoiceModel = synthVoiceModel('Dx7Voice', 'dx7_voices');
