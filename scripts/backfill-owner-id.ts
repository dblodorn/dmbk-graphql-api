/*
 * Gives every LoRA training and generated image an `ownerId` — the account
 * that owns it — from the wallet that used to. One-off, but safe to re-run:
 * it only fills records that have no `ownerId` yet, so run it again after
 * lora-trainer moves to accounts to catch records it wrote in between.
 *
 *   npm run backfill:owner-id                                  # report only
 *   npm run backfill:owner-id -- --map 0xabc…=<userId> [--map …] # dry run with mappings
 *   npm run backfill:owner-id -- --map … --apply               # write
 *
 * Every wallet that still owns unfilled records must be mapped, or nothing is
 * written: a partial run would leave some records ownerless with no record of
 * why. User ids come from `viewer { id }` after signing in with Google.
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { env } from '../src/env.js';
import { GeneratedImageModel, LoraTrainingModel } from '../src/models/lora.js';

const MISSING = { $or: [{ ownerId: { $exists: false } }, { ownerId: null }, { ownerId: '' }] };

function parseMappings(argv: string[]): Map<string, string> {
  const map = new Map<string, string>();
  argv.forEach((arg, i) => {
    if (arg !== '--map') return;
    const [wallet, userId] = (argv[i + 1] ?? '').split('=');
    if (!wallet || !userId) throw new Error(`--map expects wallet=userId, got "${argv[i + 1] ?? ''}"`);
    map.set(wallet.trim().toLowerCase(), userId.trim());
  });
  return map;
}

async function unfilledByWallet(model: typeof LoraTrainingModel | typeof GeneratedImageModel) {
  const rows = await (model as typeof LoraTrainingModel).aggregate<{ _id: string | null; count: number }>([
    { $match: MISSING },
    { $group: { _id: { $toLower: { $ifNull: ['$walletAddress', ''] } }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id ?? '', r.count]));
}

async function main(): Promise<void> {
  const mappings = parseMappings(process.argv);
  const apply = process.argv.includes('--apply');

  await connectDatabase();
  try {
    const trainings = await unfilledByWallet(LoraTrainingModel);
    const images = await unfilledByWallet(GeneratedImageModel);
    const wallets = new Set([...trainings.keys(), ...images.keys()]);

    if (wallets.size === 0) {
      console.log('Every training and image has an ownerId. Nothing to do.');
      return;
    }

    console.log('Records without ownerId, by wallet:');
    for (const w of wallets) {
      const target = mappings.get(w);
      console.log(`  ${w || '(no wallet)'}: ${trainings.get(w) ?? 0} training(s), ${images.get(w) ?? 0} image(s) → ${target ?? 'UNMAPPED'}`);
    }

    const unmapped = [...wallets].filter((w) => !mappings.has(w));
    if (unmapped.length) {
      console.log(`\n${unmapped.length} wallet(s) unmapped. Add --map <wallet>=<userId> for each; nothing written.`);
      process.exitCode = apply ? 1 : 0;
      return;
    }

    // Every target must be a real account, or the records would be owned by no one.
    const users = mongoose.connection.getClient().db(env.accountsDbName).collection('user');
    for (const userId of new Set(mappings.values())) {
      const exists = mongoose.isValidObjectId(userId)
        && (await users.countDocuments({ _id: new mongoose.mongo.ObjectId(userId) })) === 1;
      if (!exists) throw new Error(`No account with id ${userId} in ${env.accountsDbName}.`);
    }

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to write.');
      return;
    }

    for (const w of wallets) {
      const ownerId = mappings.get(w)!;
      const match = w
        ? { ...MISSING, walletAddress: { $regex: `^${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }
        : { $and: [MISSING, { $or: [{ walletAddress: { $exists: false } }, { walletAddress: null }, { walletAddress: '' }] }] };
      const t = await LoraTrainingModel.updateMany(match, { $set: { ownerId } });
      const i = await GeneratedImageModel.updateMany(match, { $set: { ownerId } });
      console.log(`  ${w || '(no wallet)'}: ${t.modifiedCount} training(s), ${i.modifiedCount} image(s) → ${ownerId}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
