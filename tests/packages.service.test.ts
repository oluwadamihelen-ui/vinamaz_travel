import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  createPackage, getAdminPackage, getPublicPackageBySlug, listAdminPackages, listPublicPackages, setPackageStatus, updatePackage,
} from "@/lib/services/packages";
import { makeUser, resetDb, validPackage } from "./helpers";

beforeEach(resetDb);

describe("public package visibility", () => {
  it("only ACTIVE packages are listed or retrievable; drafts never leak", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    await createPackage(admin, validPackage({ name: "Draft One", status: "DRAFT" }));
    await createPackage(admin, validPackage({ name: "Live One", status: "ACTIVE" }));
    await createPackage(admin, validPackage({ name: "Old One", status: "INACTIVE" }));
    const list = await listPublicPackages();
    expect(list.map((p) => p.name)).toEqual(["Live One"]);
    expect(await getPublicPackageBySlug("draft-one")).toBeNull();
    expect(await getPublicPackageBySlug("old-one")).toBeNull();
    expect((await getPublicPackageBySlug("live-one"))?.name).toBe("Live One");
  });
  it("unconfigured prices stay null (no fabricated values)", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    await createPackage(admin, validPackage({ status: "ACTIVE" }));
    const [card] = await listPublicPackages();
    expect(card?.price).toBeNull();
    expect(card?.processingEstimate).toBeNull();
    expect(card?.inclusions).toEqual([]);
  });
});

describe("package administration authorization", () => {
  it("clients, anonymous users and staff without grants cannot manage packages", async () => {
    const client = await makeUser("CLIENT", "c@x.com");
    const staff = await makeUser("STAFF", "s@x.com");
    await expect(createPackage(client, validPackage())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createPackage(staff, validPackage())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAdminPackages(client)).rejects.toBeInstanceOf(AppError);
    await expect(createPackage(null as never, validPackage())).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await db.travelPackage.count()).toBe(0);
  });
  it("staff with packages.view can read but not write; with packages.manage can write", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    const { id } = await createPackage(admin, validPackage());
    const viewer = await makeUser("STAFF", "v@x.com", ["packages.view"]);
    expect((await listAdminPackages(viewer)).length).toBe(1);
    await expect(updatePackage(viewer, id, validPackage({ name: "Hacked" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setPackageStatus(viewer, id, "ACTIVE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const editor = await makeUser("STAFF", "e@x.com", ["packages.manage", "packages.view"]);
    await updatePackage(editor, id, validPackage({ name: "Canada Visa Assistance 2", slug: "canada-visa-assistance" }));
    expect((await getAdminPackage(editor, id)).name).toBe("Canada Visa Assistance 2");
  });
  it("records audit entries for create and status changes", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    const { id } = await createPackage(admin, validPackage());
    await setPackageStatus(admin, id, "ACTIVE");
    const actions = (await db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["package.created", "package.status_changed"]);
  });
});

describe("package CRUD rules", () => {
  it("rejects duplicate slugs with a friendly conflict", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    await createPackage(admin, validPackage());
    await expect(createPackage(admin, validPackage())).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses to activate a package with no description", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    const { id } = await createPackage(admin, validPackage({ shortDescription: undefined }));
    await expect(setPackageStatus(admin, id, "ACTIVE")).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("keeps question and document ids stable across edits and removes dropped ones", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    const documentRequirements = [{ name: "International passport", isRequired: true }, { name: "Bank statement", isRequired: false }];
    const questions = [
      { label: "Marital status", type: "SELECT", options: [{ label: "Single" }, { label: "Married" }] },
      { label: "Spouse name", type: "TEXT", condition: { questionKey: "marital_status", operator: "equals", value: "married" } },
    ];
    const input = validPackage({ documentRequirements, questions, requirements: [{ type: "ELIGIBILITY", title: "Valid passport" }] });
    const { id } = await createPackage(admin, input);
    const before = await getAdminPackage(admin, id);
    expect(before.questions.map((q) => q.key)).toEqual(["marital_status", "spouse_name"]);
    expect(before.questions[1]?.condition).toMatchObject({ questionKey: "marital_status" });
    expect(before.questions[0]?.options.map((o) => o.value)).toEqual(["single", "married"]);

    await updatePackage(admin, id, { ...input, questions: [questions[0]], documentRequirements: [documentRequirements[0]] });
    const after = await getAdminPackage(admin, id);
    expect(after.questions).toHaveLength(1);
    expect(after.questions[0]?.id).toBe(before.questions[0]?.id);
    expect(after.documentRequirements).toHaveLength(1);
    expect(after.documentRequirements[0]?.id).toBe(before.documentRequirements[0]?.id);
  });
  it("supports future packages with arbitrary country/category without code changes", async () => {
    const admin = await makeUser("ADMIN", "a@x.com");
    await createPackage(admin, validPackage({ name: "Japan Student Visa", country: "Japan", category: "Study", status: "ACTIVE", price: "250000", processingEstimate: "4–6 weeks" }));
    const p = await getPublicPackageBySlug("japan-student-visa");
    expect(p?.category).toBe("Study");
    expect(p?.price?.toString()).toBe("250000");
  });
});
