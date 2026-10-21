/**
 * Process configuration, read once at import. Required values fail at startup
 * rather than at first use, so a misconfigured deploy never comes up half-working.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} environment variable is required`);
    process.exit(1);
  }
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/** A `*` is only accepted as a leading `*.` label; anything else is a typo that would never match. */
function hostPatterns(name: string): string[] {
  const patterns = list(name);
  for (const p of patterns) {
    if (p.slice(p.startsWith('*.') ? 2 : 0).includes('*')) {
      console.error(`${name}: "${p}" — a wildcard may only appear as a leading "*."`);
      process.exit(1);
    }
  }
  return patterns;
}

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  isProduction,
  port: parseInt(process.env.PORT || '4000', 10),

  mongoUri: required('MONGODB_URI'),
  /** Owned by the dmbk app. This API reads it and performs curation writes. */
  photosDbName: process.env.PHOTOS_DB_NAME || 'dmbk-photos',
  /** Owned by the lora-trainer app. */
  loraDbName: process.env.LORA_DB_NAME || 'lora-trainer',
  /** Owned by the dmbk app (the SoundCloud snapshot). Read-only here. */
  soundDbName: process.env.SOUND_DB_NAME || 'dmbk-sound',

  /** Photos store storage keys; public URLs are this base + key. No trailing slash. */
  cdnUrl: required('DO_SPACES_CDN_URL').replace(/\/+$/, ''),

  /**
   * The DigitalOcean Space shared with dmbk and lora-trainer. Required at
   * startup so a deploy without credentials fails now, not at the first upload.
   * The endpoint may carry the bucket subdomain; `lib/spaces/client.ts` strips it.
   */
  spaces: {
    endpoint: required('DO_SPACES_ENDPOINT'),
    region: required('DO_SPACES_REGION'),
    key: required('DO_SPACES_KEY'),
    secret: required('DO_SPACES_SECRET'),
    bucket: required('DO_SPACES_BUCKET'),
  },

  /**
   * Accounts (users, Google accounts, sessions) live in a database this API
   * owns, unlike the two above. better-auth creates its own collections and
   * indexes there.
   */
  accountsDbName: process.env.ACCOUNTS_DB_NAME || 'dmbk-accounts',
  /** Signs session tokens. A dev fallback is tolerated locally only. */
  authSecret: isProduction
    ? required('BETTER_AUTH_SECRET')
    : process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production-0000',
  /** This API's own public URL (https://graphql.dmbk.network in production). */
  authUrl: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || '4000'}`,
  /**
   * The web OAuth client every app signs in through. ID tokens must name it as
   * their audience. Unset locally means Google sign-in is unavailable, not that
   * the server refuses to start.
   */
  googleClientId: isProduction ? required('GOOGLE_CLIENT_ID') : process.env.GOOGLE_CLIENT_ID?.trim() || '',
  googleClientSecret: isProduction ? required('GOOGLE_CLIENT_SECRET') : process.env.GOOGLE_CLIENT_SECRET?.trim() || '',

  /** Who may sign in at all. Empty admits nobody (`auth/allowlist.ts`). */
  allowedEmails: new Set(list('ALLOWED_EMAILS')),
  /** Who may curate the photo library. Checked on every request. */
  adminEmails: new Set(list('ADMIN_EMAILS')),

  /**
   * Hosts of the sites that call this API from a browser (e.g. dmbk.io,
   * *.dmbk.io, localhost:3000) — the CORS allowlist. Pattern rules: `lib/hosts.ts`.
   */
  allowedOrigins: hostPatterns('ALLOWED_ORIGINS'),

  /**
   * Are.na's v3 API. Read anonymously: only public and closed channels are
   * served, so no credential is needed. Overridden by the tests' stub.
   */
  arenaApiUrl: (process.env.ARENA_API_URL || 'https://api.are.na/v3').replace(/\/+$/, ''),
} as const;
