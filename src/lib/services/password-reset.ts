import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { passwordSchema, emailSchema } from "@/lib/validation/auth";
import { passwordResetEmail } from "@/lib/email/templates";
import { sendEmailSafely } from "@/lib/email/provider";
import { recordAudit } from "./audit";

export const RESET_TOKEN_MINUTES = 60;
const INVALID = "This reset link is invalid or has expired. Please request a new one.";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Start a password reset. Deliberately returns nothing and never reveals whether the address
 * belongs to an account (no user enumeration): unknown/disabled accounts are a silent no-op.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = emailSchema.safeParse(rawEmail);
  if (!email.success) return;
  const user = await db.user.findUnique({ where: { email: email.data }, select: { id: true, name: true, email: true, isActive: true } });
  if (!user || !user.isActive) return;

  const token = await issueResetToken(user.id, RESET_TOKEN_MINUTES);
  await recordAudit({ actorId: null, action: "user.password_reset_requested", entityType: "User", entityId: user.id });

  const link = resetLink(token);
  await sendEmailSafely({ to: user.email, ...passwordResetEmail({ name: user.name, link, minutes: RESET_TOKEN_MINUTES }) });
}

/** Create a fresh single-use token (invalidating older ones) and return the RAW token for the emailed link. */
export async function issueResetToken(userId: string, minutes: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    // Only the newest link works.
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await tx.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + minutes * 60_000) } });
  });
  return token;
}

export function resetLink(token: string): string {
  return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

/** True if the token exists, is unused and unexpired. */
export async function isResetTokenValid(token: string): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, select: { usedAt: true, expiresAt: true } });
  return !!row && !row.usedAt && row.expiresAt > new Date();
}

export async function resetPassword(token: string, password: string, confirmPassword: string): Promise<void> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) throw new AppError("Please choose a stronger password.", "VALIDATION", { password: [parsed.error.issues[0]?.message ?? "Invalid password"] });
  if (password !== confirmPassword) throw new AppError("The passwords don't match.", "VALIDATION", { confirmPassword: ["Passwords do not match"] });
  if (!token || token.length > 200) throw new AppError(INVALID, "VALIDATION");

  const passwordHash = await hashPassword(password);
  const userId = await db.$transaction(async (tx) => {
    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row) throw new AppError(INVALID, "VALIDATION");
    // Atomic claim: concurrent uses of the same link cannot both succeed.
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new AppError(INVALID, "VALIDATION");
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.passwordResetToken.deleteMany({ where: { userId: row.userId, id: { not: row.id } } });
    return row.userId;
  });
  await recordAudit({ actorId: userId, action: "user.password_reset", entityType: "User", entityId: userId });
}
