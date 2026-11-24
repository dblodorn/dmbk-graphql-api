import { synthVoiceModel, type SynthVoiceDoc } from './synth-voice.js';

/*
 * Saved Roland Juno-60 patches in `dmbk-sound.juno60_voices` (openspec/specs/juno60-voices): the juno60 editor's
 * 42 patch bytes, base64. The shape is every synth's (`models/synth-voice.ts`).
 */

export type Juno60VoiceDoc = SynthVoiceDoc;

export const Juno60VoiceModel = synthVoiceModel('Juno60Voice', 'juno60_voices');
