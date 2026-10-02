import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { requirePermission, type Actor } from "@/lib/auth/actor";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";
import { isPermission } from "@/lib/auth/permissions";
import { recordAudit } from "./audit";
import { onClientRegistered } from "./events";

/** Self-service client registration. Always creates a CLIENT; role cannot be supplied. */
export async function registerClient(raw: unknown) {
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("Please check the highlighted fields.", "VALIDATION", z_fieldErrors(parsed.error));
  }
  const input: RegisterInput = parsed.data;
  const passwordHash = await hashPassword(input.password);
  try {
    const created = await db.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone,
        passwordHash,
        role: "CLIENT",
        clientProfile: {
          create: {
            countryOfResidence: input.countryOfResidence,
            whatsapp: input.whatsapp,
            nationality: input.nationality,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
          },
        },
      },
      select: { id: true, email: true, name: true, role: true },
    });
    await onClientRegistered(created);
    return created;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("An account with this email already exists. Try signing in instead.", "CONFLICT", {
        email: ["An account with this email already exists"],
      });
    }
    throw e;
  }
}

function z_fieldErrors(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Load the current user fresh from the database (never trust claims in the session
 * token for authorization). Returns null if the account is missing or disabled.
 */
export async function loadActor(userId: string, sessionIssuedAtSec?: number): Promise<Actor | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, permissions: true, isActive: true, passwordChangedAt: true },
  });
  if (!user || !user.isActive) return null;
  // A password reset signs out every session issued before it.
  if (user.passwordChangedAt && sessionIssuedAtSec !== undefined && sessionIssuedAtSec < Math.floor(user.passwordChangedAt.getTime() / 1000)) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, permissions: user.permissions };
}

/**
 * A client's own profile. Ownership is enforced here: the profile is looked up by the
 * *actor's* id, and staff need clients.view to read someone else's.
 */
export async function getClientProfile(actor: Actor, userId: string) {
  if (actor.id !== userId) requirePermission(actor, "clients.view");
  const profile = await db.clientProfile.findFirst({
    where: { userId },
    include: { user: { select: { id: true, name: true, email: true, phone: true } } },
  });
  if (!profile) throw new AppError("Profile not found.", "NOT_FOUND");
  return profile;
}

/** Grant staff extra permissions (SUPER_ADMIN/ADMIN with clients.manage only). */
export async function setStaffPermissions(actor: Actor, targetUserId: string, permissions: string[]) {
  requirePermission(actor, "settings.manage");
  const valid = permissions.filter(isPermission);
  const target = await db.user.update({ where: { id: targetUserId }, data: { permissions: valid }, select: { id: true } });
  await recordAudit({ actorId: actor.id, action: "user.permissions_changed", entityType: "User", entityId: target.id, metadata: { permissions: valid } });
}
