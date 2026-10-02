import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { nextApplicationNumber } from "@/lib/services/application-number";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("nextApplicationNumber", () => {
  it("is sequential and zero-padded per year", async () => {
    const d = new Date("2026-03-01T00:00:00Z");
    expect(await nextApplicationNumber(db, d)).toBe("VNZ-2026-000001");
    expect(await nextApplicationNumber(db, d)).toBe("VNZ-2026-000002");
    expect(await nextApplicationNumber(db, new Date("2027-01-01T00:00:00Z"))).toBe("VNZ-2027-000001");
  });
  it("never duplicates under heavy concurrency", async () => {
    const d = new Date("2026-06-01T00:00:00Z");
    const numbers = await Promise.all(Array.from({ length: 40 }, () => nextApplicationNumber(db, d)));
    expect(new Set(numbers).size).toBe(40);
    expect(numbers.sort()[39]).toBe("VNZ-2026-000040");
  });
  it("rolls back with its transaction so numbers stay gap-free", async () => {
    const d = new Date("2026-06-01T00:00:00Z");
    await expect(db.$transaction(async (tx) => { await nextApplicationNumber(tx, d); throw new Error("abort"); })).rejects.toThrow("abort");
    expect(await nextApplicationNumber(db, d)).toBe("VNZ-2026-000001");
  });
});
