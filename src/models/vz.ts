import { synthVoiceModel, type SynthVoiceDoc } from './synth-voice.js';

/*
 * Saved VZ-10M voices in `dmbk-sound.vz_voices` (openspec/specs/vz-voices): the 336 decoded voice bytes, base64.
 * The shape is every synth's (`models/synth-voice.ts`).
 */

export type VzVoiceDoc = SynthVoiceDoc;

export const VzVoiceModel = synthVoiceModel('VzVoice', 'vz_voices');
