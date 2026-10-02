import { describe, expect, it } from "vitest";
import { PERMISSIONS, can, effectivePermissions } from "@/lib/auth/permissions";
import { requireClient, requirePermission } from "@/lib/auth/actor";

const actor = (role: "CLIENT" | "STAFF" | "ADMIN" | "SUPER_ADMIN", permissions: string[] = []) => ({ id: "u", email: "e", name: "n", role, permissions });

describe("permissions", () => {
  it("SUPER_ADMIN has every permission", () => {
    for (const p of PERMISSIONS) expect(can(actor("SUPER_ADMIN"), p)).toBe(true);
  });
  it("ADMIN has operational access but not refunds, settings or audit", () => {
    expect(can(actor("ADMIN"), "packages.manage")).toBe(true);
    expect(can(actor("ADMIN"), "applications.assign")).toBe(true);
    for (const p of ["payments.refund", "settings.manage", "audit.view"] as const) expect(can(actor("ADMIN"), p)).toBe(false);
  });
  it("STAFF has nothing by default and only what is granted", () => {
    expect(effectivePermissions(actor("STAFF")).size).toBe(0);
    const s = actor("STAFF", ["packages.view", "not.a.permission"]);
    expect(can(s, "packages.view")).toBe(true);
    expect(can(s, "packages.manage")).toBe(false);
  });
  it("CLIENT never gains staff permissions, even if a grant is stored", () => {
    expect(can(actor("CLIENT", ["packages.manage", "payments.refund"]), "packages.manage")).toBe(false);
  });
  it("requirePermission / requireClient throw the right errors", () => {
    expect(() => requirePermission(null, "packages.view")).toThrow(/sign in/i);
    expect(() => requirePermission(actor("CLIENT"), "packages.view")).toThrow(/permission/i);
    expect(() => requireClient(actor("ADMIN"))).toThrow();
    expect(requireClient(actor("CLIENT")).role).toBe("CLIENT");
  });
});
