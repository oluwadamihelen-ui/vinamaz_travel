import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { setEmailProviderForTests, type EmailMessage } from "@/lib/email/provider";
import { resetPassword } from "@/lib/services/password-reset";
import { createStaffAccount, listStaffAccounts, resendStaffInvite, updateStaffAccount } from "@/lib/services/staff";
import { loadActor } from "@/lib/services/users";
import { makeUser, resetDb } from "./helpers";

let sent: EmailMessage[] = [];
beforeEach(async () => {
  await resetDb();
  sent = [];
  setEmailProviderForTests({ send: async (m) => { sent.push(m); } });
});

describe("staff accounts: admins manage staff only", () => {
  it("an admin can create and edit STAFF but not admins, and can't grant what they don't hold", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const admin = await makeUser("ADMIN", "admin@x.com");
    const other = await makeUser("ADMIN", "other@x.com");
    await expect(createStaffAccount(admin, { name: "New Admin", email: "na@x.com", role: "ADMIN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await createStaffAccount(admin, { name: "Sam Staff", email: "sam@x.com", role: "STAFF", permissions: ["applications.view", "payments.refund", "audit.view", "staff.manage"] });
    // ADMIN lacks payments.refund / audit.view and can't grant staff.manage: those are silently not granted
    expect((await db.user.findUniqueOrThrow({ where: { id: res.id } })).permissions).toEqual(["applications.view"]);
    await updateStaffAccount(admin, res.id, { permissions: ["documents.review"] });
    expect((await db.user.findUniqueOrThrow({ where: { id: res.id } })).permissions).toEqual(["documents.review"]);
    await expect(updateStaffAccount(admin, other.id, { isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaffAccount(admin, root.id, { isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // permissions the editor can't grant are preserved, not stripped
    await updateStaffAccount(root, res.id, { permissions: ["documents.review", "payments.refund"] });
    await updateStaffAccount(admin, res.id, { permissions: ["documents.review", "applications.view"] });
    expect((await db.user.findUniqueOrThrow({ where: { id: res.id } })).permissions.sort()).toEqual(["applications.view", "documents.review", "payments.refund"]);
    const list = await listStaffAccounts(admin);
    expect(list.every((u) => u.role === "STAFF")).toBe(true);
  });
  it("a failed invitation email hands the one-time link to the administrator, and invites can be re-sent", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    setEmailProviderForTests({ send: async () => { throw new Error("mail down"); } });
    const res = await createStaffAccount(root, { name: "Sam Staff", email: "sam@x.com", role: "STAFF" });
    expect(res.inviteEmailSent).toBe(false);
    expect(res.inviteLink).toMatch(/reset-password\?token=/);
    setEmailProviderForTests({ send: async (m) => { sent.push(m); } });
    const again = await resendStaffInvite(root, res.id);
    expect(again).toMatchObject({ inviteEmailSent: true, inviteLink: null });
    expect(sent).toHaveLength(1);
    await db.user.update({ where: { id: res.id }, data: { lastLoginAt: new Date() } });
    await expect(resendStaffInvite(root, res.id)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("staff accounts", () => {
  it("a super admin creates a staff member who sets their own password from the emailed invite", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const res = await createStaffAccount(root, { name: "Sam Staff", email: "Sam@Example.com", role: "STAFF", permissions: ["applications.view", "documents.review", "settings.manage", "bogus"] });
    expect(res.inviteEmailSent).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { id: res.id } });
    expect(user).toMatchObject({ email: "sam@example.com", role: "STAFF", isActive: true });
    expect(user.permissions).toEqual(["applications.view", "documents.review"]); // settings.manage and unknown keys dropped
    expect(sent).toHaveLength(1);
    const token = decodeURIComponent(sent[0]!.text.match(/token=(\S+)/)![1]!);
    await resetPassword(token, "my-new-staff-pass1", "my-new-staff-pass1");
    expect(await verifyPassword((await db.user.findUniqueOrThrow({ where: { id: res.id } })).passwordHash, "my-new-staff-pass1")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "user.staff_created" } })).toBe(1);
  });
  it("only staff.manage holders can manage staff; duplicates and bad input are rejected", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    await makeUser("ADMIN", "admin@x.com");
    const plain = await makeUser("STAFF", "plain@x.com", ["applications.view"]);
    const client = await makeUser("CLIENT", "c@x.com");
    for (const a of [plain, client]) {
      await expect(createStaffAccount(a, { name: "X Y", email: "x@y.com", role: "STAFF" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listStaffAccounts(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(createStaffAccount(root, { name: "Dup", email: "admin@x.com", role: "STAFF" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createStaffAccount(root, { name: "", email: "a@b.com", role: "STAFF" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createStaffAccount(root, { name: "Ok Name", email: "nope", role: "STAFF" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createStaffAccount(root, { name: "Ok Name", email: "ok@b.com", role: "SUPER_ADMIN" as never })).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("updates permissions, deactivation revokes access immediately, and guard rails hold", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const staff = await makeUser("STAFF", "s@x.com", ["applications.view"]);
    await updateStaffAccount(root, staff.id, { permissions: ["documents.review", "settings.manage"] });
    expect((await loadActor(staff.id))?.permissions).toEqual(["documents.review"]);
    await updateStaffAccount(root, staff.id, { isActive: false });
    expect(await loadActor(staff.id)).toBeNull();
    await expect(updateStaffAccount(root, root.id, { isActive: false })).rejects.toMatchObject({ code: "FORBIDDEN" }); // super admins can't be edited here
    const client = await makeUser("CLIENT", "c@x.com");
    await expect(updateStaffAccount(root, client.id, { isActive: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listStaffAccounts(root)).map((u) => u.email)).toEqual(expect.arrayContaining(["root@x.com", "s@x.com"]));
  });
});
