/*
 * Per-IP token buckets for the playground. A bucket holds `limit` tokens and
 * refills evenly over `windowSeconds`, so steady GraphiQL use keeps working
 * instead of a burst at the top of each minute and then nothing. In memory:
 * one process, and losing the state on a restart only resets the limit.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export type TakeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter({ limit, windowSeconds }: { limit: number; windowSeconds: number }) {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = limit / (windowSeconds * 1000);

  function refill(bucket: Bucket, now: number): void {
    bucket.tokens = Math.min(limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
  }

  // A full bucket is the same as no bucket; dropping them bounds memory by
  // the number of recently active IPs.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      refill(bucket, now);
      if (bucket.tokens >= limit) buckets.delete(key);
    }
  }, windowSeconds * 1000);
  sweep.unref();

  return {
    take(key: string): TakeResult {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: limit, updatedAt: now };
        buckets.set(key, bucket);
      } else {
        refill(bucket, now);
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000)) };
    },
  };
}
