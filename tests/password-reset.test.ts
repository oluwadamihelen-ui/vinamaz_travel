import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { setEmailProviderForTests, type EmailMessage } from "@/lib/email/provider";
import { isResetTokenValid, requestPasswordReset, resetPassword } from "@/lib/services/password-reset";
import { loadActor, registerClient } from "@/lib/services/users";
import { resetDb } from "./helpers";

let sent: EmailMessage[] = [];
beforeEach(async () => {
  await resetDb();
  sent = [];
  // Registration also sends a welcome email; these tests are about reset emails only.
  setEmailProviderForTests({ send: async (m) => { if (!m.subject.startsWith("Welcome")) sent.push(m); } });
});

const reg = { name: "Ada Obi", email: "ada@example.com", phone: "+2348030000000", password: "oldpassword123", confirmPassword: "oldpassword123", countryOfResidence: "Nigeria" };
const tokenFrom = (m: EmailMessage) => decodeURIComponent(m.text.match(/token=([^\s]+)/)![1]!);

async function issue() {
  const u = await registerClient(reg);
  await requestPasswordReset("ada@example.com");
  return { u, token: tokenFrom(sent[0]!) };
}

describe("requestPasswordReset", () => {
  it("emails a one-time link and stores only a hash of the token", async () => {
    const { token } = await issue();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ada@example.com");
    expect(sent[0]!.html).toContain("/reset-password?token=");
    const rows = await db.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 55 * 60_000);
    expect(rows[0]!.expiresAt.getTime()).toBeLessThan(Date.now() + 65 * 60_000);
  });
  it("does nothing, silently, for unknown or disabled accounts (no enumeration)", async () => {
    await expect(requestPasswordReset("nobody@example.com")).resolves.toBeUndefined();
    await expect(requestPasswordReset("not-an-email")).resolves.toBeUndefined();
    const u = await registerClient(reg);
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    await requestPasswordReset("ada@example.com");
    expect(sent).toHaveLength(0);
    expect(await db.passwordResetToken.count()).toBe(0);
  });
  it("a new request invalidates the previous link", async () => {
    const { token: first } = await issue();
    await requestPasswordReset("ADA@example.com");
    const second = tokenFrom(sent[1]!);
    expect(await isResetTokenValid(first)).toBe(false);
    expect(await isResetTokenValid(second)).toBe(true);
  });
  it("an email failure does not throw or leave the caller broken", async () => {
    setEmailProviderForTests({ send: async () => { throw new Error("smtp down"); } });
    await registerClient(reg);
    await expect(requestPasswordReset("ada@example.com")).resolves.toBeUndefined();
  });
});

describe("resetPassword", () => {
  it("sets the new password, burns the token, and the old password stops working", async () => {
    const { u, token } = await issue();
    await resetPassword(token, "brandnewpass456", "brandnewpass456");
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword(row.passwordHash, "brandnewpass456")).toBe(true);
    expect(await verifyPassword(row.passwordHash, "oldpassword123")).toBe(false);
    expect(row.passwordChangedAt).not.toBeNull();
    expect(await isResetTokenValid(token)).toBe(false);
    await expect(resetPassword(token, "another789pass", "another789pass")).rejects.toThrow(/invalid or has expired/);
    expect(await db.auditLog.count({ where: { action: "user.password_reset" } })).toBe(1);
  });
  it("rejects expired, unknown and malformed tokens", async () => {
    const { token } = await issue();
    await db.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPassword(token, "brandnewpass456", "brandnewpass456")).rejects.toThrow(/invalid or has expired/);
    expect(await isResetTokenValid(token)).toBe(false);
    await expect(resetPassword("nonsense", "brandnewpass456", "brandnewpass456")).rejects.toThrow(/invalid or has expired/);
    await expect(resetPassword("", "brandnewpass456", "brandnewpass456")).rejects.toThrow();
    expect(await isResetTokenValid("x".repeat(500))).toBe(false);
  });
  it("enforces password rules and confirmation without consuming the token", async () => {
    const { token } = await issue();
    await expect(resetPassword(token, "short1", "short1")).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { password: expect.any(Array) } });
    await expect(resetPassword(token, "brandnewpass456", "different456789")).rejects.toMatchObject({ fieldErrors: { confirmPassword: expect.any(Array) } });
    expect(await isResetTokenValid(token)).toBe(true);
  });
  it("a link can only be used once even under concurrency", async () => {
    const { token } = await issue();
    const results = await Promise.allSettled([1, 2, 3].map((i) => resetPassword(token, `concurrent${i}pass99`, `concurrent${i}pass99`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("signs out sessions issued before the reset", async () => {
    const { u, token } = await issue();
    const issuedBefore = Math.floor(Date.now() / 1000) - 120;
    expect((await loadActor(u.id, issuedBefore))?.id).toBe(u.id); // fine before the reset
    await resetPassword(token, "brandnewpass456", "brandnewpass456");
    expect(await loadActor(u.id, issuedBefore)).toBeNull(); // old session revoked
    expect((await loadActor(u.id, Math.floor(Date.now() / 1000) + 1))?.id).toBe(u.id); // new login works
  });
});
