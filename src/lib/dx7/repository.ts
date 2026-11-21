import { Dx7VoiceModel } from '../../models/dx7.js';
import { voiceRepository } from '../synth-voices/repository.js';
import { dx7Shape } from './shape.js';

/* DX7 voices (openspec/specs/dx7-voices), through the repository every synth's library uses. */

export class Dx7VoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`No DX7 voice with id: ${id}`);
    this.name = 'Dx7VoiceNotFoundError';
  }
}

export const { saveVoice, updateVoice, deleteVoice, listVisibleVoices, isCreator, loadVoices, setVoiceHidden } =
  voiceRepository(Dx7VoiceModel, dx7Shape, Dx7VoiceNotFoundError);
