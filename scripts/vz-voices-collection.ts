/*
 * Creates `dmbk-sound.vz_voices` with its schema validator and indexes, or
 * brings an existing collection's validator up to date. Run it once before the
 * VZ-voice mutations go live, and again whenever `src/lib/vz/shape.ts`'s
 * validator changes.
 *
 *   npm run vz:collection              # report only
 *   npm run vz:collection -- --apply   # create, or collMod the validator; ensure indexes
 *   npm run vz:collection -- --apply --collection vz_voices_scratch   # a throwaway copy, for testing
 *
 * Same plan as `scripts/chime-compositions-collection.ts`: the validator is
 * strict with the error action, indexes are created here by hand because
 * `autoIndex` is off, and updating an existing validator needs dbAdmin on
 * `dmbk-sound` (the API's user has readWrite only).
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { env } from '../src/env.js';
import { voiceJsonSchema } from '../src/lib/vz/shape.js';

const flag = process.argv.indexOf('--collection');
const COLLECTION = flag > 0 ? process.argv[flag + 1] : 'vz_voices';

const INDEXES = [
  // one creator never holds two identical voices; also how a repeat save finds the stored one
  { key: { creatorHash: 1, fingerprint: 1 }, name: 'creatorHash_1_fingerprint_1', unique: true },
  // the public listing
  { key: { hidden: 1, createdAt: -1, _id: -1 }, name: 'hidden_1_createdAt_-1__id_-1' },
  // a device key's own voices
  { key: { creatorHash: 1, hidden: 1, createdAt: -1, _id: -1 }, name: 'creatorHash_1_hidden_1_createdAt_-1__id_-1' },
] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  const db = mongoose.connection.useDb(env.soundDbName, { useCache: true }).db!;
  const validator = { $jsonSchema: voiceJsonSchema() };
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
