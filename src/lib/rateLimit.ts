/**
 * Simple in-memory rate limit (fixed window per key). Enough for a single
 * instance; with several, it would have to move to Postgres or Redis.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return function allow(key: string, now = Date.now()): boolean {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return true;
    }
    entry.count++;
    return entry.count <= limit;
  };
}
