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

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  isProduction,
  port: parseInt(process.env.PORT || '4000', 10),

  mongoUri: required('MONGODB_URI'),
  /** Owned by the dmbk app. This API reads it and performs curation writes. */
  photosDbName: process.env.PHOTOS_DB_NAME || 'dmbk-photos',
  /** Owned by the lora-trainer app. */
  loraDbName: process.env.LORA_DB_NAME || 'lora-trainer',

  /** Photos store storage keys; public URLs are this base + key. No trailing slash. */
  cdnUrl: required('DO_SPACES_CDN_URL').replace(/\/+$/, ''),

  /** A dev fallback is tolerated locally only — production must set it. */
  jwtSecret: isProduction ? required('JWT_SECRET') : process.env.JWT_SECRET || 'dev-secret-change-in-production',

  /** Lowercased wallet addresses that may curate the photo library. */
  adminAddresses: list('ALLOWED_ADDRESSES'),
  /**
   * Hosts a SIWE message may name as its `domain` — the sites users sign in
   * from (e.g. dmbk.io, localhost:3000), not this API's own host.
   */
  siweDomains: list('SIWE_DOMAINS'),
} as const;
