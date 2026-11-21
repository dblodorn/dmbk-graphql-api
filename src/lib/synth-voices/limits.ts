import { createRateLimiter } from '../api-access/rate-limit.js';

/*
 * Write budgets for a synth's voice library (saves, updates and deletes), on the same plan as chime saves
 * (`lib/chime/limits.ts`): one budget per client + visitor (`X-End-User-IP`, keyed requests only) and a daily
 * ceiling per client. In memory, like the playground's limit. Each synth has its own budgets.
 */

export class VoiceWriteRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many changes to saved voices. Try again later.');
    this.name = 'VoiceWriteRateLimitedError';
  }
}

export interface WriteLimits { rateLimit: number; rateWindowSeconds: number; dailyLimit: number }

/** `take(client, endUserIp)` spends one write from both budgets, or throws. */
export function writeBudget(limits: WriteLimits): (client: string | null, endUserIp: string | null) => void {
  const perVisitor = createRateLimiter({ limit: limits.rateLimit, windowSeconds: limits.rateWindowSeconds });
  const perClientDay = createRateLimiter({ limit: limits.dailyLimit, windowSeconds: 24 * 60 * 60 });
  return (client, endUserIp) => {
    const who = client ?? 'keyless';
    const visitor = perVisitor.take(`${who}:${endUserIp ?? 'unknown'}`);
    if (!visitor.ok) throw new VoiceWriteRateLimitedError(visitor.retryAfterSeconds);
    const day = perClientDay.take(who);
    if (!day.ok) throw new VoiceWriteRateLimitedError(day.retryAfterSeconds);
  };
}
