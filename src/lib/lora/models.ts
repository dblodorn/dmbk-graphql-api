import { InvalidInputError } from '../cursor.js';

/*
 * The fal.ai model a LoRA was trained with (`trainerModel`) and an image was
 * generated with (`generatorModel`), stored as fal.ai endpoint ids.
 *
 * Which models are offered is lora-trainer's call, so ids are checked for
 * shape only, not against a list: adding a model there needs no deploy here.
 *
 * Before lora-trainer had a model picker it only ever called the two legacy
 * endpoints (checked back to dmbk-world's first commit). Writes that omit a
 * model, and records written before the field existed, mean those.
 */

export const LEGACY_TRAINER_MODEL = 'fal-ai/flux-lora-fast-training';
export const LEGACY_GENERATOR_MODEL = 'fal-ai/flux-lora';

const MODEL_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9.-]*)+$/;
const MAX_MODEL_ID_LENGTH = 100;

export function assertModelId(value: string, field: string): void {
  if (value.length > MAX_MODEL_ID_LENGTH || !MODEL_ID.test(value)) {
    throw new InvalidInputError(`${field} must be a fal.ai endpoint id, e.g. ${LEGACY_GENERATOR_MODEL}.`);
  }
}
