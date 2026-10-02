import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Actor } from "@/lib/auth/actor";
import { hashPassword } from "@/lib/auth/password";
import { isPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { sendEmailSafely } from "@/lib/email/provider";
import { staffInviteEmail } from "@/lib/email/templates";
import { emailSchema } from "@/lib/validation/auth";
import { recordAudit } from "./audit";
import { issueResetToken, resetLink } from "./password-reset";

export const INVITE_HOURS = 72;

/** Permissions that can be granted to staff from the UI (settings.manage stays super-admin only). */
export const GRANTABLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== "settings.manage");

export async function listStaffAccounts(actor: Actor) {
  requirePermission(actor, "settings.manage");
  const users = await db.user.findMany({
    where: { role: { in: ["STAFF", "ADMIN", "SUPER_ADMIN"] } },
    orderBy: [{ role: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, permissions: true, isActive: true, lastLoginAt: true, createdAt: true, _count: { select: { assignedApplications: true } } },
  });
  return users;
}

export async function createStaffAccount(actor: Actor, input: { name: string; email: string; role: "STAFF" | "ADMIN"; permissions?: string[] }) {
  requirePermission(actor, "settings.manage");
  const name = input.name?.trim();
  if (!name || name.length < 2) throw new AppError("Enter the person's full name.", "VALIDATION", { name: ["Required"] });
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new AppError("Enter a valid email address.", "VALIDATION", { email: ["Invalid email"] });
  if (input.role !== "STAFF" && input.role !== "ADMIN") throw new AppError("Choose a role.", "VALIDATION", { role: ["Invalid role"] });
  const permissions = (input.permissions ?? []).filter(isPermission).filter((p) => p !== "settings.manage");

  let user;
  try {
    // Nobody knows this random password; the invitee sets their own through the emailed link.
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    user = await db.user.create({ data: { name, email: email.data, passwordHash, role: input.role, permissions }, select: { id: true, name: true, email: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("An account with this email already exists.", "CONFLICT", { email: ["Already in use"] });
    }
    throw e;
  }
  const token = await issueResetToken(user.id, INVITE_HOURS);
  const sent = await sendEmailSafely({ to: user.email, ...staffInviteEmail({ name: user.name, link: resetLink(token), hours: INVITE_HOURS }) });
  await recordAudit({ actorId: actor.id, action: "user.staff_created", entityType: "User", entityId: user.id, metadata: { role: input.role, permissions, inviteEmailSent: sent } });
  return { id: user.id, inviteEmailSent: sent };
}

export async function updateStaffAccount(actor: Actor, userId: string, patch: { permissions?: string[]; isActive?: boolean }) {
  requirePermission(actor, "settings.manage");
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!target || target.role === "CLIENT") throw new AppError("We couldn't find that staff account.", "NOT_FOUND");
  if (target.role === "SUPER_ADMIN") throw new AppError("Super admin accounts can't be changed here.", "FORBIDDEN");
  if (target.id === actor.id && patch.isActive === false) throw new AppError("You can't deactivate your own account.", "VALIDATION");

  const data: Prisma.UserUpdateInput = {};
  if (patch.permissions) data.permissions = patch.permissions.filter(isPermission).filter((p) => p !== "settings.manage");
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  await db.user.update({ where: { id: userId }, data });
  await recordAudit({ actorId: actor.id, action: "user.staff_updated", entityType: "User", entityId: userId, metadata: { permissions: data.permissions as string[] | undefined, isActive: patch.isActive } });
}
