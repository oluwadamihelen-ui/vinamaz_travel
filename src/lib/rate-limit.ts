import "server-only";
import { db } from "@/lib/db";

/**
 * Fixed-window rate limiter backed by Postgres, so the limit holds across ALL serverless
 * instances (an in-memory counter would only ever see one instance's traffic).
 *
 * One atomic INSERT ... ON CONFLICT DO UPDATE statement increments the counter or starts a new
 * window, so concurrent requests are counted exactly. If the database is unreachable the limiter
 * fails OPEN (the request would fail on its own database calls anyway) and logs the problem.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  try {
    const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "updatedAt")
      VALUES (${key}, NOW(), 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" <= NOW() - (${windowMs}::int * INTERVAL '1 millisecond')
                       THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= NOW() - (${windowMs}::int * INTERVAL '1 millisecond')
                             THEN NOW() ELSE "RateLimitBucket"."windowStart" END,
        "updatedAt" = NOW()
      RETURNING "count", "windowStart"`;
    const row = rows[0];
    if (!row) return { ok: true, retryAfterSec: 0 };
    if (Math.random() < 0.01) void db.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - 24 * 3600_000) } } }).catch(() => undefined);
    const ok = row.count <= limit;
    return { ok, retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((row.windowStart.getTime() + windowMs - Date.now()) / 1000)) };
  } catch (e) {
    console.error("[rate-limit] store unavailable, allowing request:", e instanceof Error ? e.message : e);
    return { ok: true, retryAfterSec: 0 };
  }
}

/** Test helper. */
export async function resetRateLimits() {
  await db.rateLimitBucket.deleteMany();
}
