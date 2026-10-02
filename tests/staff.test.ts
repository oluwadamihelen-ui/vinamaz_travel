import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { setEmailProviderForTests, type EmailMessage } from "@/lib/email/provider";
import { resetPassword } from "@/lib/services/password-reset";
import { createStaffAccount, listStaffAccounts, updateStaffAccount } from "@/lib/services/staff";
import { loadActor } from "@/lib/services/users";
import { makeUser, resetDb } from "./helpers";

let sent: EmailMessage[] = [];
beforeEach(async () => {
  await resetDb();
  sent = [];
  setEmailProviderForTests({ send: async (m) => { sent.push(m); } });
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
  it("only settings.manage holders can manage staff; duplicates and bad input are rejected", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const admin = await makeUser("ADMIN", "admin@x.com");
    const client = await makeUser("CLIENT", "c@x.com");
    for (const a of [admin, client]) {
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
    const admin = await makeUser("ADMIN", "a@x.com");
    await expect(updateStaffAccount(admin, staff.id, { isActive: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const client = await makeUser("CLIENT", "c@x.com");
    await expect(updateStaffAccount(root, client.id, { isActive: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listStaffAccounts(root)).map((u) => u.email)).toEqual(expect.arrayContaining(["root@x.com", "a@x.com", "s@x.com"]));
  });
});
