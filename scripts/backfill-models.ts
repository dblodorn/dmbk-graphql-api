/*
 * Writes the fal.ai model onto every LoRA training (`trainerModel`) and
 * generated image (`generatorModel`) recorded before the field existed. Those
 * all came from the legacy FLUX endpoints, the only ones lora-trainer called
 * before its model picker (`src/lib/lora/models.ts`). Reads already default to
 * them; this makes the history explicit in the data.
 *
 * Safe to re-run: it only fills records that have no model yet.
 *
 *   npm run backfill:models              # report only
 *   npm run backfill:models -- --apply   # write
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { GeneratedImageModel, LoraTrainingModel } from '../src/models/lora.js';
import { LEGACY_GENERATOR_MODEL, LEGACY_TRAINER_MODEL } from '../src/lib/lora/models.js';

const missing = (field: string) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] });

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  await connectDatabase();
  try {
    const trainings = await LoraTrainingModel.countDocuments(missing('trainerModel'));
    const images = await GeneratedImageModel.countDocuments(missing('generatorModel'));
    console.log(`Without a model: ${trainings} training(s), ${images} image(s).`);

    if (trainings === 0 && images === 0) {
      console.log('Nothing to do.');
      return;
    }
    if (!apply) {
      console.log(`Would set ${LEGACY_TRAINER_MODEL} / ${LEGACY_GENERATOR_MODEL}. Re-run with --apply to write.`);
      return;
    }

    const t = await LoraTrainingModel.updateMany(missing('trainerModel'), { $set: { trainerModel: LEGACY_TRAINER_MODEL } });
    const i = await GeneratedImageModel.updateMany(missing('generatorModel'), {
      $set: { generatorModel: LEGACY_GENERATOR_MODEL },
    });
    console.log(`Set ${LEGACY_TRAINER_MODEL} on ${t.modifiedCount} training(s), ${LEGACY_GENERATOR_MODEL} on ${i.modifiedCount} image(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
