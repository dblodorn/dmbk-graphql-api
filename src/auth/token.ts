import jwt from 'jsonwebtoken';
import { env } from '../env.js';

/** The signed-in wallet, as resolvers see it. */
export interface Viewer {
  /** Lowercased. */
  address: string;
  /** Derived per request from ALLOWED_ADDRESSES, never trusted from the token. */
  isAdmin: boolean;
}

const TOKEN_TTL = '7d';

export function issueToken(address: string): string {
  return jwt.sign({ sub: address.toLowerCase() }, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function viewerFor(address: string): Viewer {
  const lower = address.toLowerCase();
  return { address: lower, isAdmin: env.adminAddresses.includes(lower) };
}

/**
 * The viewer for a request, from `Authorization: Bearer <token>`. Any missing,
 * malformed, expired, or forged token is simply anonymous — never an error —
 * so public reads keep working with a stale token in the client.
 */
export function getViewerFromRequest(request: Request): Viewer | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;

  try {
    const decoded = jwt.verify(header.slice(7), env.jwtSecret);
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string') return null;
    return viewerFor(decoded.sub);
  } catch {
    return null;
  }
}
