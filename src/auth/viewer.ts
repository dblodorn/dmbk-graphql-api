import { APIError } from 'better-auth/api';
import { env } from '../env.js';
import { getAuth } from './better-auth.js';
import { isAdminEmail, isAllowedEmail } from './allowlist.js';

/** The signed-in account, as resolvers see it. */
export interface Viewer {
  /** The account's user id — what LoRA records store as `ownerId`. */
  id: string;
  email: string;
  name: string | null;
  /** From ADMIN_EMAILS on every request, never stored with the session. */
  isAdmin: boolean;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function bearerHeaders(request: Request): Headers | null {
  const header = request.headers.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  return new Headers({ authorization: header });
}

function viewerFor(user: { id: string; email: string; name?: string | null }): Viewer | null {
  // A user removed from ALLOWED_EMAILS keeps their record; this is what
  // shuts them out from their next request.
  if (!isAllowedEmail(user.email)) return null;
  return { id: user.id, email: user.email, name: user.name || null, isAdmin: isAdminEmail(user.email) };
}

/**
 * The viewer for a request, from `Authorization: Bearer <token>`. A missing,
 * malformed, expired, revoked or forged token is simply anonymous — never an
 * error — so public reads keep working with a stale token in the client.
 */
export async function getViewerFromRequest(request: Request): Promise<Viewer | null> {
  const headers = bearerHeaders(request);
  if (!headers) return null;

  try {
    const session = await getAuth().api.getSession({ headers });
    return session ? viewerFor(session.user) : null;
  } catch (error) {
    console.error('[auth] session lookup failed', error);
    return null;
  }
}

/**
 * Trade a Google ID token for a session. Every refusal — bad token, wrong
 * audience, unverified email, not on the allowlist — is the same generic
 * error, so the response does not reveal which check failed.
 */
export async function signInWithGoogle(idToken: string): Promise<{ token: string; viewer: Viewer }> {
  const fail = () => new AuthError('Sign-in failed.');
  if (!env.googleClientId) throw new AuthError('Google sign-in is not configured on this server.');

  let result;
  try {
    result = await getAuth().api.signInSocial({
      body: { provider: 'google', idToken: { token: idToken } },
      returnHeaders: true,
    });
  } catch (error) {
    if (error instanceof APIError) throw fail();
    throw error;
  }

  // The bearer plugin puts the *signed* session token here; the body's `token`
  // is the bare session id, which `requireSignature` refuses.
  const token = result.headers.get('set-auth-token');
  const user = 'user' in result.response ? result.response.user : undefined;
  const viewer = user ? viewerFor(user) : null;
  if (!token || !viewer) throw fail();

  return { token, viewer };
}

/** Revoke the request's session. True when there was one to revoke. */
export async function signOut(request: Request): Promise<boolean> {
  const headers = bearerHeaders(request);
  if (!headers) return false;
  try {
    await getAuth().api.signOut({ headers });
    return true;
  } catch (error) {
    if (error instanceof APIError) return false;
    throw error;
  }
}
