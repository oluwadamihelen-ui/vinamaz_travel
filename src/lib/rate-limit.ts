import "server-only";

/**
 * Minimal fixed-window in-memory rate limiter for sensitive endpoints (login, register).
 * LIMITATION: state is per server instance. On Vercel (serverless) this only slows down
 * bursts hitting the same warm instance; replace the Map with Upstash/Vercel KV for a
 * hard, global limit before launch.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  return { ok: bucket.count <= limit, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function resetRateLimits() {
  buckets.clear();
}
