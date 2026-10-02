import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getApplicationView, listClientApplications, saveApplicationStep, startApplication, submitApplication,
} from "@/lib/services/applications";
import { completeApplication, makeActivePackage, makeUser, resetDb, validPackage } from "./helpers";
import { createPackage } from "@/lib/services/packages";

beforeEach(resetDb);

async function setup() {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const pkg = await makeActivePackage(admin);
  const client = await makeUser("CLIENT", "ada@x.com");
  return { admin, pkg, client };
}

describe("startApplication", () => {
  it("creates a draft with a public application number, history entry and audit record", async () => {
    const { client, pkg } = await setup();
    const { id, resumed } = await startApplication(client, pkg.slug);
    expect(resumed).toBe(false);
    const app = await db.visaApplication.findUniqueOrThrow({ where: { id }, include: { statusHistory: true } });
    expect(app.applicationNumber).toMatch(/^VNZ-\d{4}-000001$/);
    expect(app.id).not.toBe(app.applicationNumber);
    expect(app.status).toBe("DRAFT");
    expect(app.packageName).toBe("Canada Visa Assistance");
    expect(app.statusHistory).toHaveLength(1);
    expect((app.applicant as Record<string, unknown>).fullName).toBe("ada");
    expect(await db.auditLog.count({ where: { action: "application.created" } })).toBe(1);
  });
  it("resumes the existing draft instead of creating a duplicate, even concurrently", async () => {
    const { client, pkg } = await setup();
    const results = await Promise.all(Array.from({ length: 6 }, () => startApplication(client, pkg.slug)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await db.visaApplication.count()).toBe(1);
  });
  it("hands out distinct sequential numbers to different clients", async () => {
    const { client, pkg } = await setup();
    const other = await makeUser("CLIENT", "bob@x.com");
    await startApplication(client, pkg.slug);
    await startApplication(other, pkg.slug);
    const numbers = (await db.visaApplication.findMany({ select: { applicationNumber: true } })).map((a) => a.applicationNumber).sort();
    expect(numbers[0]!.endsWith("000001")).toBe(true);
    expect(numbers[1]!.endsWith("000002")).toBe(true);
  });
  it("refuses draft/inactive packages, staff accounts and anonymous callers", async () => {
    const { admin, client } = await setup();
    const draft = await createPackage(admin, validPackage({ name: "Draft Pkg" }));
    await expect(startApplication(client, draft.slug)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startApplication(admin, "canada-visa-assistance")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startApplication(null as never, "canada-visa-assistance")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("draft saving and resuming", () => {
  it("saves partial data, remembers the step and reports progress", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    const r = await saveApplicationStep(client, id, "details", { fullName: "Ada Obi", phone: "+2348030000000" }, { advance: false });
    expect(r.ok).toBe(true);
    const view = await getApplicationView(client, id);
    expect((view.app.applicant as Record<string, unknown>).fullName).toBe("Ada Obi");
    expect(view.app.currentStep).toBe("details");
    expect(view.progress.percent).toBeGreaterThan(0);
    expect(view.progress.percent).toBeLessThan(100);
    expect(view.app.progressPercent).toBe(view.progress.percent);
  });
  it("blocks advancing until required fields are valid, but still keeps what was entered", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    const r = await saveApplicationStep(client, id, "details", { fullName: "Ada Obi" }, { advance: true });
    expect(r.ok).toBe(false);
    expect(r.nextStep).toBeNull();
    expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(["dateOfBirth", "nationality", "phone"]));
    expect(((await getApplicationView(client, id)).app.applicant as Record<string, unknown>).fullName).toBe("Ada Obi");
  });
  it("rejects malformed values even in a draft save", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    const r = await saveApplicationStep(client, id, "details", { phone: "not a phone", dateOfBirth: "2999-01-01" }, { advance: false });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveProperty("phone");
    expect(r.errors).toHaveProperty("dateOfBirth");
  });
  it("walks the conditional steps: hidden answers are removed and not required", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    const married = await saveApplicationStep(client, id, "s-family", { marital_status: "married" }, { advance: true });
    expect(married.ok).toBe(false);
    expect(married.errors).toHaveProperty("spouse_name");
    await saveApplicationStep(client, id, "s-family", { marital_status: "married", spouse_name: "Bola" }, { advance: true });
    expect((await getApplicationView(client, id)).answers).toMatchObject({ marital_status: "married", spouse_name: "Bola" });
    const single = await saveApplicationStep(client, id, "s-family", { marital_status: "single", spouse_name: "Bola" }, { advance: true });
    expect(single.ok).toBe(true);
    expect(single.nextStep).toBe("s-passport");
    expect((await getApplicationView(client, id)).answers.spouse_name).toBeUndefined();
  });
  it("rejects unknown steps and refuses edits after submission", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    await expect(saveApplicationStep(client, id, "nope", {}, { advance: false })).rejects.toMatchObject({ code: "VALIDATION" });
    await completeApplication(client, id);
    await submitApplication(client, id);
    await expect(saveApplicationStep(client, id, "s-passport", { passport_number: "ZZ" }, { advance: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("submitApplication", () => {
  it("refuses an incomplete application with field-level problems", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    await expect(submitApplication(client, id)).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: expect.objectContaining({ "document.international_passport": expect.any(Array), marital_status: expect.any(Array) }),
    });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });
  it("submits a complete application: status, history, audit, and cannot be submitted twice", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    await completeApplication(client, id);
    const { applicationNumber } = await submitApplication(client, id);
    expect(applicationNumber).toMatch(/^VNZ-/);
    const app = await db.visaApplication.findUniqueOrThrow({ where: { id }, include: { statusHistory: { orderBy: { createdAt: "asc" } } } });
    expect(app.status).toBe("APPLICATION_SUBMITTED");
    expect(app.submittedAt).not.toBeNull();
    expect(app.statusHistory.map((h) => h.toStatus)).toEqual(["DRAFT", "APPLICATION_SUBMITTED"]);
    expect(app.statusHistory[1]).toMatchObject({ fromStatus: "DRAFT", changedById: client.id });
    expect(await db.auditLog.count({ where: { action: "application.submitted" } })).toBe(1);
    await expect(submitApplication(client, id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("concurrent submits only succeed once", async () => {
    const { client, pkg } = await setup();
    const { id } = await startApplication(client, pkg.slug);
    await completeApplication(client, id);
    const results = await Promise.allSettled([submitApplication(client, id), submitApplication(client, id), submitApplication(client, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.visaApplication.count({ where: { status: "APPLICATION_SUBMITTED" } })).toBe(1);
    expect(await db.applicationStatusHistory.count({ where: { toStatus: "APPLICATION_SUBMITTED" } })).toBe(1);
  });
  it("after submission a client can start a fresh application for the same package", async () => {
    const { client, pkg } = await setup();
    const a = await startApplication(client, pkg.slug);
    await completeApplication(client, a.id);
    await submitApplication(client, a.id);
    const b = await startApplication(client, pkg.slug);
    expect(b.id).not.toBe(a.id);
    expect((await listClientApplications(client)).total).toBe(2);
  });
});
