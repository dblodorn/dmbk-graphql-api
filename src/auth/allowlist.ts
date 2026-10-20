import { env } from '../env.js';

/*
 * Who may sign in, and who is an admin. Both are fixed email lists in the
 * environment (`ALLOWED_EMAILS`, `ADMIN_EMAILS`), parsed by `env.ts`: trimmed,
 * lowercased, empty entries dropped. That parse matters most when a variable is
 * unset — `"".split(",")` is `[""]`, and a loose comparison against that would
 * admit everyone. Here an unset list is an empty set, which admits nobody.
 *
 * Both are checked on every request, never cached with the session, so removing
 * an address takes effect at that viewer's next request rather than whenever
 * their session would have expired.
 */

function normalise(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const candidate = normalise(email);
  return candidate !== '' && env.allowedEmails.has(candidate);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const candidate = normalise(email);
  return candidate !== '' && env.adminEmails.has(candidate);
}

if (env.allowedEmails.size === 0) {
  console.error(
    '[auth] ALLOWED_EMAILS is empty or unset, so no one can sign in. ' +
      'Set it to a comma-separated list of permitted email addresses.',
  );
}
