/**
 * Límite simple en memoria (ventana fija por clave). Suficiente para una sola
 * instancia; si escalamos a varias, habría que moverlo a Postgres o Redis.
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
