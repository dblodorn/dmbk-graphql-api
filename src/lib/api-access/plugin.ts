import type { IncomingMessage } from 'node:http';
import { specifiedRules } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import { env } from '../../env.js';
import { findActiveKey } from '../api-keys/store.js';
import { clientIp } from './client-ip.js';
import { createRateLimiter } from './rate-limit.js';
import { createPlaygroundLimitRules } from './rules.js';

/*
 * Who is calling (openspec/specs/api-access). Every request is classified in
 * `onRequest`, before its body is parsed:
 *
 *   client      a valid `X-API-Key`; the full API, session auth as usual
 *   playground  no key, enforcement on; anonymous, queries only, rate-limited
 *   legacy      no key, enforcement off; exactly as before, and logged
 *
 * A key that matches nothing (unknown, revoked, malformed) is refused outright
 * in either mode, with one message for all three. The key itself is never
 * logged or echoed.
 */

export type Access = { kind: 'client'; client: string } | { kind: 'playground' } | { kind: 'legacy' };

const accessByRequest = new WeakMap<Request, Access>();

/** The classification `onRequest` made. A request it never saw gets the most restrictive tier. */
export function accessFor(request: Request): Access {
  return accessByRequest.get(request) ?? (env.apiKeysEnforced ? { kind: 'playground' } : { kind: 'legacy' });
}

function refusal(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ errors: [{ message, extensions: { code } }] }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const KEYLESS_LOG_INTERVAL_MS = 60 * 60 * 1000;

/** While enforcement is off: who still calls without a key, once per caller per hour. */
function createKeylessLogger() {
  const lastLogged = new Map<string, number>();
  const sweep = setInterval(() => {
    const cutoff = Date.now() - KEYLESS_LOG_INTERVAL_MS;
    for (const [caller, at] of lastLogged) if (at < cutoff) lastLogged.delete(caller);
  }, KEYLESS_LOG_INTERVAL_MS);
  sweep.unref();

  return (ip: string, request: Request) => {
    const origin = request.headers.get('origin') ?? '-';
    const userAgent = request.headers.get('user-agent') ?? '-';
    const caller = `${ip} ${origin} ${userAgent}`;
    const now = Date.now();
    if (now - (lastLogged.get(caller) ?? 0) < KEYLESS_LOG_INTERVAL_MS) return;
    lastLogged.set(caller, now);
    console.log(`[api-access] keyless request ip=${ip} origin=${origin} ua=${JSON.stringify(userAgent)}`);
  };
}

export function useApiAccess(): Plugin {
  const limiter = createRateLimiter({ limit: env.playground.rateLimit, windowSeconds: env.playground.rateWindowSeconds });
  const logKeyless = createKeylessLogger();
  const playgroundRules = createPlaygroundLimitRules(env.playground);

  return {
    async onRequest({ request, serverContext, endResponse }) {
      // Preflights carry no key by design; CORS answers them.
      if (request.method === 'OPTIONS') return;

      const key = request.headers.get('x-api-key')?.trim();
      if (key) {
        let found;
        try {
          found = await findActiveKey(key);
        } catch (error) {
          // Fail closed: never downgrade to the playground because the lookup broke.
          console.error('[api-access] key lookup failed', error);
          return endResponse(refusal(503, 'UPSTREAM_ERROR', 'The API is temporarily unavailable.'));
        }
        if (!found) return endResponse(refusal(401, 'UNAUTHENTICATED', 'Invalid API key.'));
        accessByRequest.set(request, { kind: 'client', client: found.client });
        return;
      }

      const ip = clientIp(request, (serverContext as { req?: IncomingMessage }).req);
      if (!env.apiKeysEnforced) {
        logKeyless(ip, request);
        accessByRequest.set(request, { kind: 'legacy' });
        return;
      }

      const taken = limiter.take(ip);
      if (!taken.ok) {
        return endResponse(
          refusal(429, 'RATE_LIMITED', 'Too many requests without an API key. Try again shortly.', {
            'retry-after': String(taken.retryAfterSeconds),
          }),
        );
      }
      accessByRequest.set(request, { kind: 'playground' });
    },

    onValidate({ context, params, addValidationRule }) {
      const request = (context as { request?: Request }).request;
      if (!request || accessFor(request).kind !== 'playground') return;
      // Adding to an unset rule list would replace graphql's standard rules
      // rather than extend them.
      if (!params.rules) for (const rule of specifiedRules) addValidationRule(rule);
      for (const rule of playgroundRules) addValidationRule(rule);
    },
  };
}
