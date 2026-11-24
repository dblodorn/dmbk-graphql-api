import { Juno60VoiceModel } from '../../models/juno60.js';
import { voiceRepository } from '../synth-voices/repository.js';
import { juno60Shape } from './shape.js';

/* Juno-60 patches (openspec/specs/juno60-voices), through the repository every synth's library uses. */

export class Juno60VoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`No Juno-60 patch with id: ${id}`);
    this.name = 'Juno60VoiceNotFoundError';
  }
}

export const { saveVoice, updateVoice, deleteVoice, listVisibleVoices, isCreator, loadVoices, setVoiceHidden } =
  voiceRepository(Juno60VoiceModel, juno60Shape, Juno60VoiceNotFoundError);
