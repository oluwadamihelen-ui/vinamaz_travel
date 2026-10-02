import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Allocate the next public application number, e.g. VNZ-2026-000001.
 *
 * One atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement: Postgres takes a
 * row lock on the year's counter, so concurrent callers always get distinct values.
 * Call inside the same transaction that creates the application so a rolled-back
 * creation also rolls back the increment (numbers stay gap-free).
 */
export async function nextApplicationNumber(
  tx: Pick<Prisma.TransactionClient, "$queryRaw"> = db,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "ApplicationCounter" ("year", "lastValue", "updatedAt")
    VALUES (${year}, 1, NOW())
    ON CONFLICT ("year") DO UPDATE
      SET "lastValue" = "ApplicationCounter"."lastValue" + 1, "updatedAt" = NOW()
    RETURNING "lastValue"`;
  const value = rows[0]?.lastValue;
  if (!value) throw new Error("Failed to allocate application number");
  return formatApplicationNumber(year, value);
}

export function formatApplicationNumber(year: number, value: number): string {
  return `VNZ-${year}-${String(value).padStart(6, "0")}`;
}
