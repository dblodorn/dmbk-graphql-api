import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The caller's IP, for the playground rate limit. Caddy appends the client
 * address to `X-Forwarded-For`, so the rightmost entry is the one it added;
 * anything to its left came from the client and can be forged. The header is
 * trusted only when the socket peer is loopback (Caddy, or a local run) —
 * production binds to 127.0.0.1, so no other peer can reach the port.
 */
export function clientIp(request: Request, req: IncomingMessage | undefined): string {
  const peer = req?.socket.remoteAddress ?? 'unknown';
  if (!LOOPBACK.has(peer)) return peer;
  const forwarded = request.headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last || peer;
}
