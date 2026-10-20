/*
 * End-to-end check of the mutations against live data, through the API.
 *
 *   npm run test:mutations -- --setup   # once: writes TEST_PRIVATE_KEY to .env,
 *                                       # adds its address to the local ALLOWED_ADDRESSES
 *   npm run dev                         # in another terminal (restart it after --setup)
 *   npm run test:mutations              # against http://localhost:4000/graphql
 *   npm run test:mutations -- --cleanup # deletes LoRA fixtures left by a crashed run
 *
 * The test wallet is an admin only on the server whose ALLOWED_ADDRESSES lists
 * it — keep that to your local .env, never production. The local server reads
 * and writes the live Atlas data, so every change made here is restored:
 *
 * - Photos: picks a public photo, adds a uniquely named keyword and a title,
 *   checks the vocabulary counts move exactly as dmbk's rules say, restores it,
 *   then hides/unhides it the same way. The full vocabulary must end where it
 *   started. The photo's `updatedAt` is the one thing left changed.
 * - LoRA: the test wallet owns nothing real, so a pending (never public)
 *   training and a hidden image owned by it are inserted directly, used for the
 *   owner checks, and deleted. The image is public for the moment it is unhidden.
 * - Auth: anonymous and non-admin callers must be refused.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/graphql';
// Must be in the target server's SIWE_DOMAINS.
const SIWE_DOMAIN = process.env.TEST_SIWE_DOMAIN ?? 'localhost:3000';
const FIXTURE_PROMPT = 'graphql-api mutation test fixture';

// ---------------------------------------------------------------------------
// Setup / cleanup modes

function setup(): void {
  const envText = fs.readFileSync('.env', 'utf8');
  const existing = envText.match(/^TEST_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1];
  const key = (existing ?? generatePrivateKey()) as `0x${string}`;
  const address = privateKeyToAccount(key).address.toLowerCase();

  let next = envText;
  if (!existing) next = next.replace(/\n?$/, '\n') + `TEST_PRIVATE_KEY=${key}\n`;

  const allowed = next.match(/^ALLOWED_ADDRESSES=(.*)$/m);
  const list = (allowed?.[1] ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (!list.includes(address)) {
    const line = `ALLOWED_ADDRESSES=${[...list, address].join(',')}`;
    next = allowed ? next.replace(/^ALLOWED_ADDRESSES=.*$/m, line) : next.replace(/\n?$/, '\n') + line + '\n';
  }

  if (next !== envText) fs.writeFileSync('.env', next);
  console.log(`Test wallet ${address} is in .env (key ${existing ? 'reused' : 'generated'}).`);
  console.log('Restart `npm run dev` so the server picks up ALLOWED_ADDRESSES.');
}

async function withDb<T>(fn: (models: typeof import('../src/models/lora.js')) => Promise<T>): Promise<T> {
  const { connectDatabase } = await import('../src/db/mongoose.js');
  const mongoose = (await import('mongoose')).default;
  await connectDatabase();
  try {
    return await fn(await import('../src/models/lora.js'));
  } finally {
    await mongoose.disconnect();
  }
}

async function cleanupFixtures(address: string): Promise<void> {
  // Only documents this script creates: the test wallet's, marked as fixtures.
  await withDb(async ({ LoraTrainingModel, GeneratedImageModel }) => {
    const owner = { walletAddress: address };
    const images = await GeneratedImageModel.deleteMany({ ...owner, prompt: FIXTURE_PROMPT });
    const trainings = await LoraTrainingModel.deleteMany({ ...owner, triggerWord: 'graphqlapitest' });
    console.log(`Deleted ${trainings.deletedCount} fixture training(s), ${images.deletedCount} fixture image(s).`);
  });
}

// ---------------------------------------------------------------------------
// GraphQL client

interface GqlError {
  message: string;
  extensions?: { code?: string };
}

async function gql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<{ data: T | null; errors?: GqlError[] }> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  return res.json() as Promise<{ data: T | null; errors?: GqlError[] }>;
}

/** Data, or throw on any GraphQL error. */
async function ok<T = any>(query: string, variables: Record<string, unknown> = {}, token?: string): Promise<T> {
  const { data, errors } = await gql<T>(query, variables, token);
  if (errors?.length) throw new Error(`GraphQL error: ${errors.map((e) => `${e.extensions?.code}: ${e.message}`).join('; ')}`);
  return data as T;
}

async function signIn(account: PrivateKeyAccount): Promise<{ token: string; isAdmin: boolean }> {
  const { siweNonce } = await ok<{ siweNonce: string }>('mutation { siweNonce }');
  const message = createSiweMessage({
    address: account.address,
    chainId: 1,
    domain: SIWE_DOMAIN,
    nonce: siweNonce,
    uri: `http://${SIWE_DOMAIN}`,
    version: '1',
    statement: 'graphql-api mutation test',
  });
  const signature = await account.signMessage({ message });
  const data = await ok(
    `mutation($input: SignInWithEthereumInput!) {
       signInWithEthereum(input: $input) { token viewer { address isAdmin } }
     }`,
    { input: { message, signature } },
  );
  return { token: data.signInWithEthereum.token, isAdmin: data.signInWithEthereum.viewer.isAdmin };
}

const globalId = (type: string, id: string) => Buffer.from(`${type}:${id}`).toString('base64');

// ---------------------------------------------------------------------------
// Assertions

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
  }
}

async function expectRefused(name: string, query: string, variables: Record<string, unknown>, token: string | undefined, codes: string[]) {
  const { errors } = await gql(query, variables, token);
  const code = errors?.[0]?.extensions?.code;
  check(`${name} → ${codes.join('/')}`, !!code && codes.includes(code), errors ?? 'no error');
}

type Vocabulary = Map<string, { label: string; count: number }>;

async function vocabulary(): Promise<Vocabulary> {
  const data = await ok<{ dmbkPhotosKeywords: { slug: string; label: string; count: number }[] }>('{ dmbkPhotosKeywords { slug label count } }');
  return new Map(data.dmbkPhotosKeywords.map((k) => [k.slug, { label: k.label, count: k.count }]));
}

/** Slugs whose label differs between two snapshots (present in both). */
function labelChanges(a: Vocabulary, b: Vocabulary): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  for (const [slug, k] of a) {
    const other = b.get(slug);
    if (other && other.label !== k.label) out[slug] = [k.label, other.label];
  }
  return out;
}

/** Slugs whose count differs between two snapshots, with the delta. */
function diff(a: Vocabulary, b: Vocabulary): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slug of new Set([...a.keys(), ...b.keys()])) {
    const d = (b.get(slug)?.count ?? 0) - (a.get(slug)?.count ?? 0);
    if (d !== 0) out[slug] = d;
  }
  return out;
}

const sameDelta = (actual: Record<string, number>, expected: Record<string, number>) =>
  JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());

// ---------------------------------------------------------------------------
// Queries

const PHOTO_FIELDS = 'id title keywords hidden status updatedAt';
const UPDATE_PHOTO = `mutation($input: DmbkPhotosUpdatePhotoInput!) { dmbkPhotosUpdatePhoto(input: $input) { photo { ${PHOTO_FIELDS} } } }`;
const SET_PHOTO_HIDDEN = `mutation($input: DmbkPhotosSetPhotoHiddenInput!) { dmbkPhotosSetPhotoHidden(input: $input) { photo { ${PHOTO_FIELDS} } } }`;
const SET_TRAINING_HIDDEN = `mutation($input: LoraTrainerSetTrainingHiddenInput!) { loraTrainerSetTrainingHidden(input: $input) { loraTraining { id hidden } } }`;
const SET_IMAGE_HIDDEN = `mutation($input: LoraTrainerSetImageHiddenInput!) { loraTrainerSetImageHidden(input: $input) { generatedImage { id hidden } } }`;
const NODE = `query($id: ID!) { node(id: $id) { id ... on Photo { hidden } ... on LoraTraining { hidden } ... on GeneratedImage { hidden } } }`;

// ---------------------------------------------------------------------------
// Suites

async function photoSuite(adminToken: string, otherToken: string): Promise<void> {
  console.log('\nPhotos');

  // Newest public photo with keywords, so hiding it moves counts — but only
  // keywords other photos share. Hiding the last photo carrying a keyword
  // deletes its vocabulary entry, and unhiding recreates it with the slug as
  // its label, so the original display label would be lost.
  const start = await vocabulary();
  const { dmbkPhotos: photos } = await ok('{ dmbkPhotos(first: 100) { edges { node { id title keywords } } } }');
  const target = photos.edges
    .map((e: any) => e.node)
    .find((p: any) => p.keywords.length > 0 && p.keywords.every((k: string) => (start.get(k)?.count ?? 0) >= 2));
  if (!target) throw new Error('No public photo whose keywords are all shared with another photo.');
  console.log(`  using ${target.id} (${target.keywords.length} keywords)`);

  const original = (await ok(`query($id: ID!) { node(id: $id) { ... on Photo { ${PHOTO_FIELDS} } } }`, { id: target.id }, adminToken)).node;
  check('admin sees hidden/status', original.hidden === false && original.status === 'READY', original);

  // Auth: refused without admin, and nothing changes.
  await expectRefused('dmbkPhotosUpdatePhoto anonymous', UPDATE_PHOTO, { input: { id: target.id, title: 'x' } }, undefined, ['UNAUTHENTICATED', 'FORBIDDEN']);
  await expectRefused('dmbkPhotosUpdatePhoto non-admin', UPDATE_PHOTO, { input: { id: target.id, title: 'x' } }, otherToken, ['FORBIDDEN', 'UNAUTHENTICATED']);
  await expectRefused('dmbkPhotosSetPhotoHidden non-admin', SET_PHOTO_HIDDEN, { input: { id: target.id, hidden: true } }, otherToken, ['FORBIDDEN', 'UNAUTHENTICATED']);

  const suffix = crypto.randomBytes(3).toString('hex');
  const testLabel = `ZZ GraphQL Test ${suffix}`;
  const testSlug = `zz-graphql-test-${suffix}`;

  try {
    // Add a keyword (with messy spelling) and a title.
    const updated = (
      await ok(UPDATE_PHOTO, { input: { id: target.id, title: `  test title ${suffix}  `, keywords: [...original.keywords, `  ${testLabel} `, original.keywords[0]] } }, adminToken)
    ).dmbkPhotosUpdatePhoto.photo;
    check('keyword normalized and de-duplicated', JSON.stringify(updated.keywords) === JSON.stringify([...original.keywords, testSlug]), updated.keywords);
    check('title trimmed', updated.title === `test title ${suffix}`, updated.title);
    check('updatedAt advanced', updated.updatedAt > original.updatedAt);

    const afterAdd = await vocabulary();
    check('only the new keyword count moved (+1)', sameDelta(diff(start, afterAdd), { [testSlug]: 1 }), diff(start, afterAdd));
    check('new keyword keeps its first label', afterAdd.get(testSlug)?.label === testLabel, afterAdd.get(testSlug));

    // Invalid input is refused and changes nothing.
    await expectRefused('over-long title', UPDATE_PHOTO, { input: { id: target.id, title: 'x'.repeat(201) } }, adminToken, ['BAD_USER_INPUT']);

    // Restore.
    const restored = (await ok(UPDATE_PHOTO, { input: { id: target.id, title: original.title, keywords: original.keywords } }, adminToken)).dmbkPhotosUpdatePhoto.photo;
    check('photo restored', restored.title === original.title && JSON.stringify(restored.keywords) === JSON.stringify(original.keywords), restored);
    const afterRestore = await vocabulary();
    check('vocabulary back to start (test keyword removed)', sameDelta(diff(start, afterRestore), {}), diff(start, afterRestore));

    // Hide: every keyword on the photo loses one count, and the public can't see it.
    const hidden = (await ok(SET_PHOTO_HIDDEN, { input: { id: target.id, hidden: true } }, adminToken)).dmbkPhotosSetPhotoHidden.photo;
    check('hidden set', hidden.hidden === true);
    const afterHide = await vocabulary();
    const expectHide = Object.fromEntries(original.keywords.map((k: string) => [k, -1]));
    check("each of the photo's keywords −1", sameDelta(diff(start, afterHide), expectHide), diff(start, afterHide));
    check('hidden photo is null for anonymous', (await ok(NODE, { id: target.id })).node === null);
    check('hidden photo visible to admin', (await ok(NODE, { id: target.id }, adminToken)).node?.hidden === true);

    const again = (await ok(SET_PHOTO_HIDDEN, { input: { id: target.id, hidden: true } }, adminToken)).dmbkPhotosSetPhotoHidden.photo;
    check('hiding twice is a no-op', again.updatedAt === hidden.updatedAt && sameDelta(diff(afterHide, await vocabulary()), {}));

    await ok(SET_PHOTO_HIDDEN, { input: { id: target.id, hidden: false } }, adminToken);
    check('unhidden photo visible to anonymous', (await ok(NODE, { id: target.id })).node?.id === target.id);
    const end = await vocabulary();
    check('vocabulary back to start after unhide', sameDelta(diff(start, end), {}), diff(start, end));
    check('no labels changed', Object.keys(labelChanges(start, end)).length === 0, labelChanges(start, end));
  } finally {
    // Whatever happened above, put the photo back.
    await ok(UPDATE_PHOTO, { input: { id: target.id, title: original.title, keywords: original.keywords } }, adminToken).catch((e) => console.error('  ! restore failed:', e));
    await ok(SET_PHOTO_HIDDEN, { input: { id: target.id, hidden: original.hidden } }, adminToken).catch((e) => console.error('  ! unhide failed:', e));
  }
}

async function loraSuite(owner: string, ownerToken: string, otherToken: string): Promise<void> {
  console.log('\nLoRA');

  const trainingId = crypto.randomBytes(12).toString('hex');
  const imageId = crypto.randomBytes(12).toString('hex');
  const now = new Date().toISOString();

  await withDb(async ({ LoraTrainingModel, GeneratedImageModel }) => {
    // Pending: never in the public listing. Image starts hidden.
    await LoraTrainingModel.create({
      _id: trainingId, requestId: `test-${trainingId}`, walletAddress: owner, triggerWord: 'graphqlapitest',
      steps: 1, status: 'pending', hidden: false, createdAt: now,
    });
    await GeneratedImageModel.create({
      _id: imageId, loraTrainingId: trainingId, walletAddress: owner, prompt: FIXTURE_PROMPT,
      imageUrl: 'https://example.invalid/graphql-api-test.png', hidden: true, createdAt: now,
    });
  });

  try {
    const tId = globalId('LoraTraining', trainingId);
    const iId = globalId('GeneratedImage', imageId);

    check('pending training null for anonymous', (await ok(NODE, { id: tId })).node === null);
    check('pending training visible to owner', (await ok(NODE, { id: tId }, ownerToken)).node?.id === tId);

    await expectRefused('loraTrainerSetTrainingHidden anonymous', SET_TRAINING_HIDDEN, { input: { id: tId, hidden: true } }, undefined, ['UNAUTHENTICATED', 'FORBIDDEN']);
    // Non-public record: a non-owner gets NOT_FOUND, so it can't be probed.
    await expectRefused('loraTrainerSetTrainingHidden non-owner (non-public)', SET_TRAINING_HIDDEN, { input: { id: tId, hidden: true } }, otherToken, ['NOT_FOUND']);

    const t1 = (await ok(SET_TRAINING_HIDDEN, { input: { id: tId, hidden: true } }, ownerToken)).loraTrainerSetTrainingHidden.loraTraining;
    check('owner hides training', t1.hidden === true);
    const t2 = (await ok(SET_TRAINING_HIDDEN, { input: { id: tId, hidden: false } }, ownerToken)).loraTrainerSetTrainingHidden.loraTraining;
    check('owner unhides training', t2.hidden === false);

    await expectRefused('loraTrainerSetImageHidden non-owner (hidden)', SET_IMAGE_HIDDEN, { input: { id: iId, hidden: false } }, otherToken, ['NOT_FOUND']);
    const i1 = (await ok(SET_IMAGE_HIDDEN, { input: { id: iId, hidden: false } }, ownerToken)).loraTrainerSetImageHidden.generatedImage;
    check('owner unhides image', i1.hidden === false);
    check('visible image public to anonymous', (await ok(NODE, { id: iId })).node?.id === iId);
    // Now public: a non-owner gets FORBIDDEN rather than NOT_FOUND.
    await expectRefused('loraTrainerSetImageHidden non-owner (public)', SET_IMAGE_HIDDEN, { input: { id: iId, hidden: true } }, otherToken, ['FORBIDDEN']);
    const i2 = (await ok(SET_IMAGE_HIDDEN, { input: { id: iId, hidden: true } }, ownerToken)).loraTrainerSetImageHidden.generatedImage;
    check('owner re-hides image', i2.hidden === true);
    check('hidden image null for anonymous', (await ok(NODE, { id: iId })).node === null);
  } finally {
    await withDb(async ({ LoraTrainingModel, GeneratedImageModel }) => {
      await GeneratedImageModel.deleteOne({ _id: imageId, walletAddress: owner });
      await LoraTrainingModel.deleteOne({ _id: trainingId, walletAddress: owner });
    }).catch((e) => console.error('  ! fixture cleanup failed (run --cleanup):', e));
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.argv.includes('--setup')) return setup();

  const key = process.env.TEST_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error('TEST_PRIVATE_KEY is not set. Run with --setup first.');
  const account = privateKeyToAccount(key);
  const address = account.address.toLowerCase();

  if (process.argv.includes('--cleanup')) return cleanupFixtures(address);

  console.log(`API ${API_URL}\nTest wallet ${address}`);

  const admin = await signIn(account);
  check('test wallet signs in', !!admin.token);
  if (!admin.isAdmin) {
    throw new Error(`${address} is not an admin on ${API_URL}. Run --setup and restart the local server.`);
  }

  // A fresh wallet nobody has allow-listed: signed in, not admin, owns nothing.
  const other = await signIn(privateKeyToAccount(generatePrivateKey()));
  check('random wallet signs in as non-admin', !!other.token && !other.isAdmin);

  // A replayed or foreign-domain message must not sign in.
  const { siweNonce } = await ok<{ siweNonce: string }>('mutation { siweNonce }');
  const foreign = createSiweMessage({ address: account.address, chainId: 1, domain: 'evil.example', nonce: siweNonce, uri: 'https://evil.example', version: '1' });
  await expectRefused('sign-in from a foreign domain', 'mutation($input: SignInWithEthereumInput!) { signInWithEthereum(input: $input) { token } }',
    { input: { message: foreign, signature: await account.signMessage({ message: foreign }) } }, undefined, ['UNAUTHENTICATED']);

  await photoSuite(admin.token, other.token);
  await loraSuite(address, admin.token, other.token);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
