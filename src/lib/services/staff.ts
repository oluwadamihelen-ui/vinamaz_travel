import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Actor } from "@/lib/auth/actor";
import { hashPassword } from "@/lib/auth/password";
import { can, isPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { sendEmailSafely } from "@/lib/email/provider";
import { staffInviteEmail } from "@/lib/email/templates";
import { emailSchema } from "@/lib/validation/auth";
import { recordAudit } from "./audit";
import { issueResetToken, resetLink } from "./password-reset";

export const INVITE_HOURS = 72;

/** Permissions that can be granted to staff from the UI (settings.manage stays super-admin only). */
export const GRANTABLE_PERMISSIONS = PERMISSIONS.filter((p) => p !== "settings.manage");

type StaffRole = "STAFF" | "ADMIN";

/** Which roles this actor may create and edit: super admins manage staff and admins, everyone else with staff.manage manages staff only. */
function manageableRoles(actor: Actor): StaffRole[] {
  return actor.role === "SUPER_ADMIN" ? ["STAFF", "ADMIN"] : ["STAFF"];
}

/** What this actor may grant: only permissions they hold themselves (no privilege escalation); staff.manage is super-admin-only to grant. */
export function grantablePermissionsFor(actor: Actor): string[] {
  return GRANTABLE_PERMISSIONS.filter((p) => can(actor, p) && (p !== "staff.manage" || actor.role === "SUPER_ADMIN"));
}

function sanitisePermissions(actor: Actor, wanted: readonly string[] | undefined): string[] {
  const allowed = new Set(grantablePermissionsFor(actor));
  return [...new Set((wanted ?? []).filter(isPermission).filter((p) => allowed.has(p)))];
}

export async function listStaffAccounts(actor: Actor) {
  requirePermission(actor, "staff.manage");
  const roles = actor.role === "SUPER_ADMIN" ? (["STAFF", "ADMIN", "SUPER_ADMIN"] as const) : (["STAFF"] as const);
  const users = await db.user.findMany({
    where: { role: { in: [...roles] } },
    orderBy: [{ role: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, permissions: true, isActive: true, lastLoginAt: true, createdAt: true, _count: { select: { assignedApplications: true } } },
  });
  return users;
}

async function sendInvite(user: { id: string; name: string; email: string }) {
  const token = await issueResetToken(user.id, INVITE_HOURS);
  const link = resetLink(token);
  const sent = await sendEmailSafely({ to: user.email, ...staffInviteEmail({ name: user.name, link, hours: INVITE_HOURS }) });
  // If the email couldn't be sent, hand the one-time link to the administrator so they can pass it on themselves.
  return { inviteEmailSent: sent, inviteLink: sent ? null : link };
}

export async function createStaffAccount(actor: Actor, input: { name: string; email: string; role: StaffRole; permissions?: string[] }) {
  requirePermission(actor, "staff.manage");
  const name = input.name?.trim();
  if (!name || name.length < 2) throw new AppError("Enter the person's full name.", "VALIDATION", { name: ["Required"] });
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new AppError("Enter a valid email address.", "VALIDATION", { email: ["Invalid email"] });
  if (input.role !== "STAFF" && input.role !== "ADMIN") throw new AppError("Choose a role.", "VALIDATION", { role: ["Invalid role"] });
  if (!manageableRoles(actor).includes(input.role)) throw new AppError("Only a super admin can create admin accounts.", "FORBIDDEN");
  const permissions = sanitisePermissions(actor, input.permissions);

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
  const invite = await sendInvite(user);
  await recordAudit({ actorId: actor.id, action: "user.staff_created", entityType: "User", entityId: user.id, metadata: { role: input.role, permissions, inviteEmailSent: invite.inviteEmailSent } });
  return { id: user.id, ...invite };
}

async function loadManageable(actor: Actor, userId: string) {
  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, permissions: true, lastLoginAt: true } });
  if (!target || target.role === "CLIENT") throw new AppError("We couldn't find that staff account.", "NOT_FOUND");
  if (target.role === "SUPER_ADMIN") throw new AppError("Super admin accounts can't be changed here.", "FORBIDDEN");
  if (!manageableRoles(actor).includes(target.role as StaffRole)) throw new AppError("Only a super admin can change admin accounts.", "FORBIDDEN");
  return target;
}

export async function updateStaffAccount(actor: Actor, userId: string, patch: { permissions?: string[]; isActive?: boolean }) {
  requirePermission(actor, "staff.manage");
  const target = await loadManageable(actor, userId);
  if (target.id === actor.id && patch.isActive === false) throw new AppError("You can't deactivate your own account.", "VALIDATION");

  const data: Prisma.UserUpdateInput = {};
  if (patch.permissions) {
    // Permissions the editor can't grant are neither added nor removed: they keep whatever the person already had.
    const allowed = new Set(grantablePermissionsFor(actor));
    const kept = target.permissions.filter((p) => !allowed.has(p));
    data.permissions = [...new Set([...kept, ...sanitisePermissions(actor, patch.permissions)])];
  }
  if (patch.isActive !== undefined) data.isActive = patch.isActive;
  await db.user.update({ where: { id: userId }, data });
  await recordAudit({ actorId: actor.id, action: "user.staff_updated", entityType: "User", entityId: userId, metadata: { permissions: data.permissions as string[] | undefined, isActive: patch.isActive } });
}

/** Issue a fresh invitation (the old link stops working). Only for accounts that have never signed in. */
export async function resendStaffInvite(actor: Actor, userId: string) {
  requirePermission(actor, "staff.manage");
  const target = await loadManageable(actor, userId);
  if (target.lastLoginAt) throw new AppError("This person has already signed in. They can use \"Forgot password?\" if needed.", "VALIDATION");
  const invite = await sendInvite(target);
  await recordAudit({ actorId: actor.id, action: "user.staff_invite_resent", entityType: "User", entityId: target.id, metadata: { inviteEmailSent: invite.inviteEmailSent } });
  return invite;
}
