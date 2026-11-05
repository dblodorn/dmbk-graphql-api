/*
 * Creates `dmbk-sound.chime_compositions` with its schema validator and
 * indexes, or brings an existing collection's validator up to date. Run it
 * once before the save mutation goes live, and again whenever
 * `src/lib/chime/catalog.json` grows (the scale and voice lists are part of
 * the validator).
 *
 *   npm run chime:collection              # report only
 *   npm run chime:collection -- --apply   # create, or collMod the validator; ensure indexes
 *   npm run chime:collection -- --apply --collection chime_compositions_scratch   # a throwaway copy, for testing
 *
 * The validator is strict with the error action, so MongoDB itself refuses a
 * document that doesn't fit `lib/chime/shape.ts`, whoever writes it. Indexes
 * are created here by hand because `autoIndex` is off (`db/mongoose.ts`).
 * `SOUND_DB_NAME` points the whole run at another database.
 *
 * The API's database user has readWrite on `dmbk-sound`: enough to create the
 * collection and its indexes, not to `collMod` an existing validator, which
 * needs dbAdmin. Updating the validator after a catalog change therefore needs
 * that role granted (Atlas → Database Access) or a run with another user.
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { env } from '../src/env.js';
import { compositionJsonSchema } from '../src/lib/chime/shape.js';

const flag = process.argv.indexOf('--collection');
const COLLECTION = flag > 0 ? process.argv[flag + 1] : 'chime_compositions';

const INDEXES = [
  { key: { fingerprint: 1 }, name: 'fingerprint_1', unique: true },
  { key: { hidden: 1, createdAt: -1, _id: -1 }, name: 'hidden_1_createdAt_-1__id_-1' },
] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  const db = mongoose.connection.useDb(env.soundDbName, { useCache: true }).db!;
  const validator = { $jsonSchema: compositionJsonSchema() };
  const options = { validator, validationLevel: 'strict', validationAction: 'error' } as const;
  const label = `${env.soundDbName}.${COLLECTION}`;

  const [existing] = await db.listCollections({ name: COLLECTION }).toArray();
  if (!existing) {
    console.log(`${label}: missing → ${apply ? 'creating' : 'would create'} with the validator`);
    if (apply) await db.createCollection(COLLECTION, options);
  } else {
    const current = (existing as { options?: Record<string, unknown> }).options ?? {};
    const same =
      JSON.stringify(current.validator) === JSON.stringify(validator) &&
      current.validationLevel === 'strict' &&
      current.validationAction === 'error';
    console.log(`${label}: exists, validator ${same ? 'up to date' : apply ? 'out of date → updating' : 'out of date → would update'}`);
    if (!same && apply) {
      try {
        await db.command({ collMod: COLLECTION, ...options });
      } catch (error) {
        if ((error as { code?: number }).code !== 8000 && (error as { code?: number }).code !== 13) throw error;
        throw new Error(`Not allowed to collMod ${label}: the database user needs dbAdmin on ${env.soundDbName}.`);
      }
    }
  }

  const have = existing || apply ? await db.collection(COLLECTION).indexes().catch(() => []) : [];
  for (const index of INDEXES) {
    const found = have.some((i) => i.name === index.name);
    console.log(`${label} index ${index.name}: ${found ? 'present' : apply ? 'creating' : 'would create'}`);
    if (!found && apply) {
      const { key, ...rest } = index;
      await db.collection(COLLECTION).createIndex(key, rest);
    }
  }

  if (!apply) console.log('Report only. Re-run with --apply to make these changes.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
