import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

beforeEach(resetRateLimits);

describe("database-backed rate limiter", () => {
  it("allows up to the limit then blocks, reporting how long to wait", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit("k1", 3, 60_000)).ok).toBe(true);
    const blocked = await rateLimit("k1", 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
  });
  it("keys are independent", async () => {
    await rateLimit("a", 1, 60_000);
    expect((await rateLimit("a", 1, 60_000)).ok).toBe(false);
    expect((await rateLimit("b", 1, 60_000)).ok).toBe(true);
  });
  it("starts a fresh window once the old one has expired", async () => {
    await rateLimit("w", 1, 200);
    expect((await rateLimit("w", 1, 200)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 260));
    expect((await rateLimit("w", 1, 200)).ok).toBe(true);
  });
  it("counts concurrent requests exactly (no lost updates across instances)", async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit("race", 10, 60_000)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect((await db.rateLimitBucket.findUniqueOrThrow({ where: { key: "race" } })).count).toBe(30);
  });
});
