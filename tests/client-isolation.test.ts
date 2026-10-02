import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getApplicationView, getOwnedApplication, listClientApplications, saveApplicationStep, startApplication, submitApplication } from "@/lib/services/applications";
import { listOwnedDocuments, openDocument, uploadDocument } from "@/lib/services/documents";
import { getClientProfile } from "@/lib/services/users";
import { PDF, completeApplication, makeActivePackage, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);

/** Critical security suite: Client A must never reach Client B's data. */
async function world() {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const pkg = await makeActivePackage(admin);
  const a = await makeUser("CLIENT", "a@x.com");
  const b = await makeUser("CLIENT", "b@x.com");
  const appA = await startApplication(a, pkg.slug);
  const appB = await startApplication(b, pkg.slug);
  await completeApplication(b, appB.id);
  const docB = await db.applicationDocument.findFirstOrThrow({ where: { applicationId: appB.id } });
  return { a, b, appA, appB, docB, pkg };
}

describe("client isolation: applications", () => {
  it("A cannot read, list, save, upload to, or submit B's application", async () => {
    const { a, appB } = await world();
    await expect(getOwnedApplication(a, appB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getApplicationView(a, appB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveApplicationStep(a, appB.id, "s-passport", { passport_number: "HACK" }, { advance: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(submitApplication(a, appB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uploadDocument(a, { applicationId: appB.id, requirementKey: "international_passport", filename: "x.pdf", bytes: PDF })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listOwnedDocuments(a, appB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const list = await listClientApplications(a);
    expect(list.items.map((i) => i.id)).not.toContain(appB.id);
    expect(list.total).toBe(1);
    // B's data is untouched
    expect((await db.applicationAnswer.findFirstOrThrow({ where: { applicationId: appB.id, questionKey: "passport_number" } })).value).toBe("A1234567");
    expect(await db.applicationDocument.count({ where: { applicationId: appB.id } })).toBe(1);
  });
  it("a non-existent id and another client's id are indistinguishable", async () => {
    const { a, appB } = await world();
    const real = await getOwnedApplication(a, appB.id).catch((e) => e);
    const fake = await getOwnedApplication(a, "cknonexistent000000000000").catch((e) => e);
    expect(real.message).toBe(fake.message);
    expect(real.code).toBe(fake.code);
  });
});

describe("client isolation: documents", () => {
  it("A cannot open B's document, and gets the same answer as for a missing id", async () => {
    const { a, b, docB } = await world();
    const stolen = await openDocument(a, docB.id).catch((e) => e);
    const missing = await openDocument(a, "ckmissing000000000000000").catch((e) => e);
    expect(stolen).toMatchObject({ code: "NOT_FOUND" });
    expect(stolen.message).toBe(missing.message);
    expect((await openDocument(b, docB.id)).doc.id).toBe(docB.id);
  });
});

describe("client isolation: profile and roles", () => {
  it("A cannot read B's profile; staff accounts cannot act as clients", async () => {
    const { a, b, pkg } = await world();
    await expect(getClientProfile(a, b.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const staff = await makeUser("SUPER_ADMIN", "root@x.com");
    await expect(startApplication(staff, pkg.slug)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listClientApplications(staff)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
