import { env } from '../../env.js';
import { createRateLimiter } from '../api-access/rate-limit.js';

/*
 * Write budgets for VZ voices (saves, updates and deletes), on the same plan
 * as chime saves (`lib/chime/limits.ts`): one budget per client + visitor
 * (`X-End-User-IP`, keyed requests only) and a daily ceiling per client. In
 * memory, like the playground's limit.
 */

export class VzWriteRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many changes to saved voices. Try again later.');
    this.name = 'VzWriteRateLimitedError';
  }
}

const perVisitor = createRateLimiter({ limit: env.vzWrites.rateLimit, windowSeconds: env.vzWrites.rateWindowSeconds });
const perClientDay = createRateLimiter({ limit: env.vzWrites.dailyLimit, windowSeconds: 24 * 60 * 60 });

/** Spend one write from both budgets, or throw. */
export function takeWrite(client: string | null, endUserIp: string | null): void {
  const who = client ?? 'keyless';
  const visitor = perVisitor.take(`${who}:${endUserIp ?? 'unknown'}`);
  if (!visitor.ok) throw new VzWriteRateLimitedError(visitor.retryAfterSeconds);
  const day = perClientDay.take(who);
  if (!day.ok) throw new VzWriteRateLimitedError(day.retryAfterSeconds);
}
