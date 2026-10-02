import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import type { Role } from "@/generated/prisma/enums";

export async function resetDb() {
  await db.auditLog.deleteMany();
  await db.travelPackage.deleteMany();
  await db.applicationCounter.deleteMany();
  await db.user.deleteMany();
}

export async function makeUser(role: Role, email: string, permissions: string[] = []): Promise<Actor> {
  const u = await db.user.create({
    data: {
      email, name: email.split("@")[0]!, passwordHash: "x", role, permissions,
      ...(role === "CLIENT" ? { clientProfile: { create: { countryOfResidence: "Nigeria" } } } : {}),
    },
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role, permissions: u.permissions };
}

export const validPackage = (over: Record<string, unknown> = {}) => ({
  name: "Canada Visa Assistance", country: "Canada", currency: "NGN", status: "DRAFT",
  shortDescription: "Professional application support.", ...over,
});
