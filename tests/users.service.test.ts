import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getClientProfile, loadActor, registerClient, setStaffPermissions } from "@/lib/services/users";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

const reg = (over: Record<string, unknown> = {}) => ({
  name: "Ada Obi", email: "ada@example.com", phone: "+2348030000000", password: "longenough123", countryOfResidence: "Nigeria", ...over,
});

describe("registerClient", () => {
  it("creates a CLIENT with an argon2id hash and a profile", async () => {
    const u = await registerClient(reg({ role: "SUPER_ADMIN", permissions: "packages.manage" }));
    expect(u.role).toBe("CLIENT");
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { clientProfile: true } });
    expect(row.passwordHash).not.toContain("longenough123");
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(row.permissions).toEqual([]);
    expect(row.clientProfile?.countryOfResidence).toBe("Nigeria");
  });
  it("enforces unique email case-insensitively", async () => {
    await registerClient(reg());
    await expect(registerClient(reg({ email: "ADA@example.com" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.user.count()).toBe(1);
  });
  it("returns field errors for invalid input without creating anything", async () => {
    await expect(registerClient(reg({ password: "x" }))).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { password: expect.any(Array) } });
    expect(await db.user.count()).toBe(0);
  });
});

describe("loadActor", () => {
  it("returns fresh role/permissions and null for disabled or missing users", async () => {
    const staff = await makeUser("STAFF", "s@x.com", ["packages.view"]);
    expect((await loadActor(staff.id))?.permissions).toEqual(["packages.view"]);
    await db.user.update({ where: { id: staff.id }, data: { role: "CLIENT" } });
    expect((await loadActor(staff.id))?.role).toBe("CLIENT"); // demotion takes effect immediately
    await db.user.update({ where: { id: staff.id }, data: { isActive: false } });
    expect(await loadActor(staff.id)).toBeNull();
    expect(await loadActor("does-not-exist")).toBeNull();
  });
});

describe("client data isolation (profile)", () => {
  it("Client A can read their own profile but not Client B's", async () => {
    const a = await makeUser("CLIENT", "a@x.com");
    const b = await makeUser("CLIENT", "b@x.com");
    expect((await getClientProfile(a, a.id)).user.email).toBe("a@x.com");
    await expect(getClientProfile(a, b.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getClientProfile(b, a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("staff need clients.view to read a client profile", async () => {
    const c = await makeUser("CLIENT", "c@x.com");
    const staff = await makeUser("STAFF", "s@x.com");
    await expect(getClientProfile(staff, c.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const viewer = await makeUser("STAFF", "v@x.com", ["clients.view"]);
    expect((await getClientProfile(viewer, c.id)).user.email).toBe("c@x.com");
    const admin = await makeUser("ADMIN", "ad@x.com");
    expect((await getClientProfile(admin, c.id)).user.email).toBe("c@x.com");
  });
});

describe("staff permission grants", () => {
  it("only settings.manage holders (SUPER_ADMIN) can grant, and unknown keys are dropped", async () => {
    const staff = await makeUser("STAFF", "s@x.com");
    const admin = await makeUser("ADMIN", "a@x.com");
    const root = await makeUser("SUPER_ADMIN", "r@x.com");
    await expect(setStaffPermissions(admin, staff.id, ["packages.manage"])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setStaffPermissions(root, staff.id, ["packages.manage", "bogus.key"]);
    expect((await loadActor(staff.id))?.permissions).toEqual(["packages.manage"]);
  });
});
