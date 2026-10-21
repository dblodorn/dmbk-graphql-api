/*
 * Moves the SoundCloud snapshot out of `dmbk-photos` into `dmbk-sound`, so the
 * photos database holds photos only. One-off, but safe to re-run: a copy never
 * replaces a newer snapshot (later `fetchedAt`) with an older one, so run it
 * again after dmbk switches over to catch a build that wrote to the old place.
 *
 *   npm run move:sound-snapshots                    # report only
 *   npm run move:sound-snapshots -- --apply         # copy into dmbk-sound
 *   npm run move:sound-snapshots -- --drop-source   # drop dmbk-photos.sound_snapshots
 *
 * `--drop-source` refuses unless dmbk-sound holds every source document at
 * least as new as the source's. Database names come from `PHOTOS_DB_NAME` /
 * `SOUND_DB_NAME`, so the whole run can be pointed at scratch databases.
 *
 * Raw collection handles rather than Mongoose models: the old location has no
 * model any more, and `autoCreate` is off, so models could never create the
 * target collection.
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { env } from '../src/env.js';

const COLLECTION = 'sound_snapshots';

interface SnapshotDoc {
  _id: string;
  fetchedAt?: string;
  [field: string]: unknown;
}

function collections() {
  const source = mongoose.connection.useDb(env.photosDbName, { useCache: true }).collection<SnapshotDoc>(COLLECTION);
  const target = mongoose.connection.useDb(env.soundDbName, { useCache: true }).collection<SnapshotDoc>(COLLECTION);
  return { source, target };
}

async function sourceExists(): Promise<boolean> {
  const db = mongoose.connection.useDb(env.photosDbName, { useCache: true }).db!;
  return (await db.listCollections({ name: COLLECTION }, { nameOnly: true }).toArray()).length > 0;
}

/** ISO-8601 strings sort chronologically as strings. A missing date is oldest. */
function isNewer(a: SnapshotDoc, b: SnapshotDoc): boolean {
  return (a.fetchedAt ?? '') > (b.fetchedAt ?? '');
}

async function copy(apply: boolean): Promise<void> {
  const { source, target } = collections();
  const docs = await source.find().toArray();
  if (docs.length === 0) {
    console.log(`${env.photosDbName}.${COLLECTION} is empty or absent. Nothing to copy.`);
    return;
  }

  for (const doc of docs) {
    const existing = await target.findOne({ _id: doc._id });
    const label = `${doc._id} (source fetchedAt ${doc.fetchedAt ?? 'none'})`;
    if (!existing) {
      console.log(`${label}: missing in ${env.soundDbName} → ${apply ? 'inserting' : 'would insert'}`);
      if (apply) await target.insertOne(doc);
    } else if (isNewer(doc, existing)) {
      console.log(`${label}: target is older (${existing.fetchedAt ?? 'none'}) → ${apply ? 'replacing' : 'would replace'}`);
      if (apply) await target.replaceOne({ _id: doc._id, fetchedAt: existing.fetchedAt }, doc);
    } else {
      console.log(`${label}: target is as new or newer (${existing.fetchedAt ?? 'none'}), nothing to do`);
    }
  }
  if (!apply) console.log('\nReport only. Re-run with --apply to copy.');
}

async function dropSource(): Promise<void> {
  if (!(await sourceExists())) {
    console.log(`${env.photosDbName}.${COLLECTION} does not exist. Nothing to drop.`);
    return;
  }
  const { source, target } = collections();
  const docs = await source.find().toArray();
  const behind: string[] = [];
  for (const doc of docs) {
    const existing = await target.findOne({ _id: doc._id });
    if (!existing) behind.push(`${doc._id}: missing in ${env.soundDbName}`);
    else if (isNewer(doc, existing)) behind.push(`${doc._id}: ${env.soundDbName} has ${existing.fetchedAt}, source has ${doc.fetchedAt}`);
  }
  if (behind.length > 0) {
    console.error(`Refusing to drop ${env.photosDbName}.${COLLECTION}; ${env.soundDbName} is behind:`);
    for (const line of behind) console.error(`  ${line}`);
    console.error('Run with --apply first.');
    process.exitCode = 1;
    return;
  }
  await source.drop();
  console.log(`Dropped ${env.photosDbName}.${COLLECTION} (${docs.length} document(s), all present in ${env.soundDbName}).`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const drop = process.argv.includes('--drop-source');
  if (apply && drop) throw new Error('Pass --apply or --drop-source, not both: verify the copy before dropping.');

  await connectDatabase();
  try {
    if (drop) await dropSource();
    else await copy(apply);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
