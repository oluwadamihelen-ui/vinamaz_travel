import { describe, expect, it } from "vitest";
import { registerSchema } from "@/lib/validation/auth";
import { packageInputSchema } from "@/lib/validation/package";
import { safeNext } from "@/lib/safe-redirect";
import { keyify, slugify } from "@/lib/slug";
import { formatMoney } from "@/lib/utils";
import { formatApplicationNumber } from "@/lib/services/application-number";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const reg = { name: "Ada Obi", email: " ADA@Example.com ", phone: "+234 803 000 0000", password: "longenough123", confirmPassword: "longenough123", countryOfResidence: "Nigeria" };

describe("registration validation", () => {
  it("normalises email and accepts optional fields as blank", () => {
    const r = registerSchema.parse({ ...reg, whatsapp: "", nationality: "", dateOfBirth: "" });
    expect(r.email).toBe("ada@example.com");
    expect(r.whatsapp).toBeUndefined();
  });
  it("rejects weak passwords, bad phones and future birth dates", () => {
    expect(registerSchema.safeParse({ ...reg, password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg, password: "onlyletterslong" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg, phone: "abc" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg, dateOfBirth: "2999-01-01" }).success).toBe(false);
  });
  it("requires the confirmation to match the password", () => {
    const r = registerSchema.safeParse({ ...reg, confirmPassword: "different12345" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["confirmPassword"]);
    expect(registerSchema.safeParse({ ...reg, confirmPassword: "" }).success).toBe(false);
  });
  it("ignores a supplied role (not part of the schema)", () => {
    expect(registerSchema.parse({ ...reg, role: "SUPER_ADMIN" })).not.toHaveProperty("role");
  });
});

describe("password hashing", () => {
  it("uses argon2id and verifies", async () => {
    const h = await hashPassword("correct horse 99");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse 99")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
  });
});

describe("package validation", () => {
  const base = { name: "Canada Visa Assistance", country: "Canada", currency: "ngn", status: "DRAFT" };
  it("treats blank money as unknown (undefined), never zero", () => {
    const p = packageInputSchema.parse({ ...base, price: "", serviceFee: "" });
    expect(p.price).toBeUndefined();
    expect(p.serviceFee).toBeUndefined();
    expect(p.currency).toBe("NGN");
    expect(p.slug).toBe("canada-visa-assistance");
  });
  it("rejects negative money and activating without any description", () => {
    expect(packageInputSchema.safeParse({ ...base, price: "-5" }).success).toBe(false);
    expect(packageInputSchema.safeParse({ ...base, status: "ACTIVE" }).success).toBe(false);
    expect(packageInputSchema.safeParse({ ...base, status: "ACTIVE", shortDescription: "ok" }).success).toBe(true);
  });
  it("requires options for choice questions and valid conditions", () => {
    const q = { label: "Marital status", type: "SELECT", options: [] };
    expect(packageInputSchema.safeParse({ ...base, questions: [q] }).success).toBe(false);
    const ok = { label: "Marital status", type: "SELECT", options: [{ label: "Married" }] };
    const dep = { label: "Spouse name", type: "TEXT", condition: { questionKey: "nope", operator: "equals", value: "married" } };
    expect(packageInputSchema.safeParse({ ...base, questions: [ok, dep] }).success).toBe(false);
    const dep2 = { ...dep, condition: { questionKey: "marital_status", operator: "equals", value: "married" } };
    expect(packageInputSchema.safeParse({ ...base, questions: [ok, dep2] }).success).toBe(true);
  });
});

describe("helpers", () => {
  it("safeNext blocks open redirects", () => {
    expect(safeNext("/client/dashboard", "/x")).toBe("/client/dashboard");
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", undefined, 5]) expect(safeNext(bad, "/x")).toBe("/x");
  });
  it("slugify / keyify", () => {
    expect(slugify("  Côte d'Ivoire & Ghana!! ")).toBe("cote-d-ivoire-and-ghana");
    expect(keyify("Marital Status")).toBe("marital_status");
  });
  it("formatMoney returns null for unknown amounts", () => {
    expect(formatMoney(null, "NGN")).toBeNull();
    expect(formatMoney(undefined, "NGN")).toBeNull();
    expect(formatMoney("150000", "NGN")).toContain("150,000");
  });
  it("formats application numbers", () => {
    expect(formatApplicationNumber(2026, 1)).toBe("VNZ-2026-000001");
    expect(formatApplicationNumber(2026, 123456)).toBe("VNZ-2026-123456");
  });
});
