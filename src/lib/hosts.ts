/*
 * Host allowlist matching for CORS (the request's `Origin`, checked against
 * ALLOWED_ORIGINS). Mirrors dmbk's `isAllowedHost` (`src/lib/auth.ts`):
 * a pattern is either an exact host (`dmbk.io`, `localhost:3000`) or `*.` plus
 * a suffix (`*.dmbk.io`), which matches any subdomain at any depth but not the
 * apex itself — list `dmbk.io` separately.
 *
 * Only wildcard domains whose DNS you control. `*.vercel.app` would trust every
 * Vercel deployment, including ones anyone else can create, so any site there
 * could call this API from a signed-in visitor's browser.
 */

export function isAllowedHost(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((pattern) => (pattern.startsWith('*.') ? h.endsWith(pattern.slice(1)) : h === pattern));
}

/**
 * An `Origin` header is allowed when its host is, over https — or over http
 * for localhost, which is how local clients run.
 */
export function isAllowedOrigin(origin: string, patterns: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  return secure && isAllowedHost(url.host, patterns);
}
