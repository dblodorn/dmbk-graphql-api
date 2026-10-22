/*
 * Issue, list and revoke per-client API keys (`dmbk-accounts.api_clients`).
 * Changes take effect on the next request; nothing to deploy or restart.
 *
 *   npm run api-client -- create <client>                 # prints the key, once
 *   npm run api-client -- list                            # never shows a key or hash
 *   npm run api-client -- revoke <client> [--key <keyId>] # all of its keys, or one
 *
 * Rotate: create a second key, deploy it to the client, then revoke the old
 * one by its key id. Both work in between.
 */
import mongoose from 'mongoose';
import { connectDatabase } from '../src/db/mongoose.js';
import { createKey, listKeys, revokeKeys } from '../src/lib/api-keys/store.js';

const CLIENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function usage(): never {
  console.error('Usage: npm run api-client -- create <client> | list | revoke <client> [--key <keyId>]');
  process.exit(1);
}

function clientArg(value: string | undefined): string {
  if (!value || !CLIENT_NAME.test(value)) {
    console.error(`Client names are kebab-case (e.g. dmbk-photo), got "${value ?? ''}"`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !['create', 'list', 'revoke'].includes(command)) usage();

  await connectDatabase();
  try {
    if (command === 'create') {
      const client = clientArg(args[0]);
      const { key, keyId } = await createKey(client);
      console.log(`Issued key ${keyId} for ${client}. It is shown once; store it as DMBK_GRAPHQL_API_KEY:\n\n  ${key}\n`);
    } else if (command === 'list') {
      const keys = await listKeys();
      if (keys.length === 0) console.log('No API clients.');
      console.table(
        keys.map((k) => ({
          client: k.client,
          keyId: k.keyId,
          created: k.createdAt,
          lastUsed: k.lastUsedAt ?? '—',
          revoked: k.revokedAt ?? '—',
        })),
      );
    } else {
      const client = clientArg(args[0]);
      const flag = args.indexOf('--key');
      const keyId = flag === -1 ? undefined : args[flag + 1];
      if (flag !== -1 && !keyId) usage();
      const count = await revokeKeys(client, keyId);
      console.log(count ? `Revoked ${count} key(s) of ${client}.` : `No active key${keyId ? ` ${keyId}` : ''} for ${client}.`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
