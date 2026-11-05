import { env } from '../../env.js';
import { createRateLimiter } from '../api-access/rate-limit.js';

/*
 * Save budgets (openspec/specs/chime-compositions, "Save rate limits"). Saves
 * are anonymous and arrive from a client's server, so the visitor is the IP
 * that client forwards (`X-End-User-IP`, keyed requests only). One budget per
 * client + visitor, one shared budget for a client's requests with no visitor
 * IP, and a daily ceiling per client. In memory, like the playground's limit.
 */

export class ChimeSaveRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many saves. Try again later.');
    this.name = 'ChimeSaveRateLimitedError';
  }
}

const perVisitor = createRateLimiter({ limit: env.chimeSaves.rateLimit, windowSeconds: env.chimeSaves.rateWindowSeconds });
const perClientDay = createRateLimiter({ limit: env.chimeSaves.dailyLimit, windowSeconds: 24 * 60 * 60 });

/** Spend one save from both budgets, or throw. Refused saves cost nothing from the daily ceiling. */
export function takeSave(client: string | null, endUserIp: string | null): void {
  const who = client ?? 'keyless';
  const visitor = perVisitor.take(`${who}:${endUserIp ?? 'unknown'}`);
  if (!visitor.ok) throw new ChimeSaveRateLimitedError(visitor.retryAfterSeconds);
  const day = perClientDay.take(who);
  if (!day.ok) throw new ChimeSaveRateLimitedError(day.retryAfterSeconds);
}
