import { VzVoiceModel } from '../../models/vz.js';
import { voiceRepository } from '../synth-voices/repository.js';
import { vzShape } from './shape.js';

/* VZ voices (openspec/specs/vz-voices), through the repository every synth's library uses. */

export class VzVoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`No VZ voice with id: ${id}`);
    this.name = 'VzVoiceNotFoundError';
  }
}

export type { VoiceFilter } from '../synth-voices/repository.js';

export const { saveVoice, updateVoice, deleteVoice, listVisibleVoices, isCreator, loadVoices, setVoiceHidden } =
  voiceRepository(VzVoiceModel, vzShape, VzVoiceNotFoundError);
