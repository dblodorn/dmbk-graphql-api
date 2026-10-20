/*
 * End-to-end check of the mutations against live data, through the API.
 *
 *   npm run test:mutations -- --setup   # once: adds the test accounts' emails to the
 *                                       # local ALLOWED_EMAILS / ADMIN_EMAILS in .env
 *   npm run dev                         # in another terminal (restart it after --setup)
 *   npm run test:mutations              # against http://localhost:4000/graphql
 *   npm run test:mutations -- --cleanup # deletes fixtures left by a crashed run
 *
 * A real Google ID token can't be scripted, so the test accounts and their
 * sessions are created directly in `dmbk-accounts` through better-auth's own
 * adapter, and the bearer tokens are signed the way `signInWithGoogle` returns
 * them. The accounts use `.invalid` addresses and are admitted only by a
 * server whose ALLOWED_EMAILS lists them — keep that to your local .env, never
 * production. They are deleted at the end of every run.
 *
 * The local server reads and writes the live Atlas data, so every change made
 * here is restored:
 *
 * - Photos: picks a public photo, adds a uniquely named keyword and a title,
 *   checks the vocabulary counts move exactly as dmbk's rules say, restores it,
 *   then hides/unhides it the same way. The full vocabulary must end where it
 *   started. The photo's `updatedAt` is the one thing left changed.
 * - LoRA: the test account owns nothing real, so a pending (never public)
 *   training and a hidden image owned by it are inserted directly, used for the
 *   owner checks, and deleted. The image is public for the moment it is unhidden.
 * - Auth: anonymous, non-admin, de-listed and signed-out callers must be refused.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { serializeSignedCookie } from 'better-call';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/graphql';
const FIXTURE_PROMPT = 'graphql-api mutation test fixture';
const FIXTURE_TRIGGER = 'graphqlapitest';

const ADMIN_EMAIL = 'graphql-api-test-admin@example.invalid';
const MEMBER_EMAIL = 'graphql-api-test-member@example.invalid';
/** Has a user and a session but is not on ALLOWED_EMAILS: a removed account. */
const DELISTED_EMAIL = 'graphql-api-test-delisted@example.invalid';
const TEST_EMAILS = [ADMIN_EMAIL, MEMBER_EMAIL, DELISTED_EMAIL];

// ---------------------------------------------------------------------------
// Setup / cleanup modes

function addToList(envText: string, name: string, email: string): string {
  const line = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  const list = (line?.[1] ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (list.includes(email)) return envText;
  const next = `${name}=${[...list, email].join(',')}`;
  return line ? envText.replace(new RegExp(`^${name}=.*$`, 'm'), next) : envText.replace(/\n?$/, '\n') + next + '\n';
}

function setup(): void {
  const envText = fs.readFileSync('.env', 'utf8');
  let next = addToList(envText, 'ALLOWED_EMAILS', ADMIN_EMAIL);
  next = addToList(next, 'ALLOWED_EMAILS', MEMBER_EMAIL);
  next = addToList(next, 'ADMIN_EMAILS', ADMIN_EMAIL);
  if (next !== envText) fs.writeFileSync('.env', next);
  console.log(`Test accounts are in the local ALLOWED_EMAILS (${ADMIN_EMAIL} also in ADMIN_EMAILS).`);
  console.log('Restart `npm run dev` so the server picks them up.');
}

/**
 * Run with the database connected. Reuses an open connection and leaves it
 * open: better-auth holds the same client, and closing it mid-run would break
 * the account cleanup that follows.
 */
async function withDb<T>(fn: (models: typeof import('../src/models/lora.js')) => Promise<T>): Promise<T> {
  const { connectDatabase } = await import('../src/db/mongoose.js');
  const mongoose = (await import('mongoose')).default;
  const owned = mongoose.connection.readyState !== mongoose.ConnectionStates.connected;
  if (owned) await connectDatabase();
  try {
    return await fn(await import('../src/models/lora.js'));
  } finally {
    if (owned) await mongoose.disconnect();
  }
}

interface TestAccount {
  id: string;
  token: string;
}

/**
 * Create (or reuse) the test users and give each a fresh session. The admin
 * and member go through better-auth's internal adapter, so the sign-up hook
 * runs exactly as it does for Google; the de-listed one is inserted under it,
 * since the hook would refuse it — which is the point.
 */
async function createAccounts(): Promise<Record<string, TestAccount>> {
  const { getAuth } = await import('../src/auth/better-auth.js');
  const { env } = await import('../src/env.js');
  const ctx = await getAuth().$context;

  const out: Record<string, TestAccount> = {};
  for (const email of TEST_EMAILS) {
    const found = await ctx.internalAdapter.findUserByEmail(email);
    let userId = found?.user.id;
    if (!userId) {
      const data = { email, name: `graphql-api test (${email.split('@')[0]})`, emailVerified: true };
      const user = email === DELISTED_EMAIL
        ? await ctx.adapter.create<{ id: string }>({ model: 'user', data: { ...data, createdAt: new Date(), updatedAt: new Date() } })
        : await ctx.internalAdapter.createUser(data, { method: 'admin' });
      if (!user) throw new Error(`Could not create ${email}. Run --setup and check ALLOWED_EMAILS in .env.`);
      userId = user.id;
    }
    const session = await ctx.internalAdapter.createSession(userId);
    // The same signed form the bearer plugin hands back as `set-auth-token`.
    const signed = decodeURIComponent((await serializeSignedCookie('', session.token, env.authSecret)).replace('=', ''));
    out[email] = { id: userId, token: signed };
  }
  return out;
}

async function deleteAccounts(): Promise<number> {
  const { getAuth } = await import('../src/auth/better-auth.js');
  const ctx = await getAuth().$context;
  let deleted = 0;
  for (const email of TEST_EMAILS) {
    const found = await ctx.internalAdapter.findUserByEmail(email);
    if (!found) continue;
    await ctx.internalAdapter.deleteUserSessions(found.user.id);
    await ctx.internalAdapter.deleteUser(found.user.id);
    deleted++;
  }
  return deleted;
}

async function cleanup(): Promise<void> {
  // Only documents this script creates: marked fixtures, and the .invalid test accounts.
  await withDb(async ({ LoraTrainingModel, GeneratedImageModel }) => {
    const images = await GeneratedImageModel.deleteMany({ prompt: FIXTURE_PROMPT });
    const trainings = await LoraTrainingModel.deleteMany({ triggerWord: FIXTURE_TRIGGER, requestId: /^test-/ });
    const accounts = await deleteAccounts();
    console.log(`Deleted ${trainings.deletedCount} fixture training(s), ${images.deletedCount} fixture image(s), ${accounts} test account(s).`);
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

async function loraSuite(ownerId: string, ownerToken: string, otherToken: string): Promise<void> {
  console.log('\nLoRA');

  const trainingId = crypto.randomBytes(12).toString('hex');
  const imageId = crypto.randomBytes(12).toString('hex');
  const now = new Date().toISOString();

  await withDb(async ({ LoraTrainingModel, GeneratedImageModel }) => {
    // Pending: never in the public listing. Image starts hidden.
    await LoraTrainingModel.create({
      _id: trainingId, requestId: `test-${trainingId}`, ownerId, triggerWord: FIXTURE_TRIGGER,
      steps: 1, status: 'pending', hidden: false, createdAt: now,
    });
    await GeneratedImageModel.create({
      _id: imageId, loraTrainingId: trainingId, ownerId, prompt: FIXTURE_PROMPT,
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
      await GeneratedImageModel.deleteOne({ _id: imageId, ownerId });
      await LoraTrainingModel.deleteOne({ _id: trainingId, ownerId });
    }).catch((e) => console.error('  ! fixture cleanup failed (run --cleanup):', e));
  }
}

// ---------------------------------------------------------------------------

const VIEWER = '{ viewer { id email isAdmin } }';

async function authSuite(accounts: Record<string, TestAccount>): Promise<void> {
  console.log('\nAuth');
  const admin = accounts[ADMIN_EMAIL];
  const member = accounts[MEMBER_EMAIL];
  const delisted = accounts[DELISTED_EMAIL];

  const me = (await ok(VIEWER, {}, admin.token)).viewer;
  check('admin session resolves as admin', me?.id === admin.id && me.email === ADMIN_EMAIL && me.isAdmin === true, me);
  const m = (await ok(VIEWER, {}, member.token)).viewer;
  check('member session resolves as non-admin', m?.id === member.id && m.isAdmin === false, m);

  check('anonymous viewer is null', (await ok(VIEWER)).viewer === null);
  check('forged token is anonymous, not an error', (await ok(VIEWER, {}, `${admin.token.split('.')[0]}.forged`)).viewer === null);
  check('unsigned session id is anonymous', (await ok(VIEWER, {}, admin.token.split('.')[0])).viewer === null);
  check('account removed from ALLOWED_EMAILS is anonymous', (await ok(VIEWER, {}, delisted.token)).viewer === null);

  await expectRefused('signInWithGoogle with a garbage token', 'mutation($input: SignInWithGoogleInput!) { signInWithGoogle(input: $input) { token } }',
    { input: { idToken: 'not-a-google-id-token' } }, undefined, ['UNAUTHENTICATED']);

  // Sign out a throwaway session of the member's, then reuse it.
  const { getAuth } = await import('../src/auth/better-auth.js');
  const { env } = await import('../src/env.js');
  const ctx = await getAuth().$context;
  const extra = await ctx.internalAdapter.createSession(member.id);
  const extraToken = decodeURIComponent((await serializeSignedCookie('', extra.token, env.authSecret)).replace('=', ''));
  check('second session works', (await ok(VIEWER, {}, extraToken)).viewer?.id === member.id);
  check('signOut revokes it', (await ok('mutation { signOut }', {}, extraToken)).signOut === true);
  check('revoked token is anonymous', (await ok(VIEWER, {}, extraToken)).viewer === null);
  check('other sessions survive signOut', (await ok(VIEWER, {}, member.token)).viewer?.id === member.id);
  check('signOut without a session is false', (await ok('mutation { signOut }')).signOut === false);
}

async function main(): Promise<void> {
  if (process.argv.includes('--setup')) return setup();

  const mongoose = (await import('mongoose')).default;
  const { connectDatabase } = await import('../src/db/mongoose.js');
  await connectDatabase();

  if (process.argv.includes('--cleanup')) {
    await mongoose.disconnect();
    return cleanup();
  }

  console.log(`API ${API_URL}`);
  let accounts: Record<string, TestAccount>;
  try {
    accounts = await createAccounts();
  } catch (e) {
    await mongoose.disconnect();
    throw e;
  }

  try {
    const admin = accounts[ADMIN_EMAIL];
    if (!(await ok(VIEWER, {}, admin.token)).viewer?.isAdmin) {
      throw new Error(`${ADMIN_EMAIL} is not an admin on ${API_URL}. Run --setup and restart the local server.`);
    }
    await authSuite(accounts);
    await photoSuite(admin.token, accounts[MEMBER_EMAIL].token);
    await loraSuite(admin.id, admin.token, accounts[MEMBER_EMAIL].token);
  } finally {
    await deleteAccounts().catch((e) => console.error('  ! test account cleanup failed (run --cleanup):', e));
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
