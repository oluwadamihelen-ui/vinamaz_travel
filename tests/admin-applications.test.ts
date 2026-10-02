import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getApplicationView, getClientDashboard } from "@/lib/services/applications";
import {
  addApplicationNote, assignApplication, changeApplicationStatus, getAdminApplicationView, getApplicationFilterOptions,
  getManagedApplication, listAdminApplications, reviewDocument,
} from "@/lib/services/admin-applications";
import { openDocument, uploadDocument } from "@/lib/services/documents";
import { PDF, STAFF_PERMS, makeActivePackage, makeUser, resetDb, submittedApplication } from "./helpers";

beforeEach(resetDb);

async function world() {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const root = await makeUser("SUPER_ADMIN", "root@x.com");
  const pkg = await makeActivePackage(admin);
  const staffA = await makeUser("STAFF", "sa@x.com", STAFF_PERMS);
  const staffB = await makeUser("STAFF", "sb@x.com", STAFF_PERMS);
  const clientA = await makeUser("CLIENT", "ada@x.com");
  const clientB = await makeUser("CLIENT", "bob@x.com");
  await db.user.update({ where: { id: clientA.id }, data: { name: "Ada Obi", phone: "+2348011111111" } });
  await db.user.update({ where: { id: clientB.id }, data: { name: "Bob Eze", phone: "+2348022222222" } });
  const appA = await submittedApplication(clientA, pkg.slug);
  const appB = await submittedApplication(clientB, pkg.slug);
  return { admin, root, pkg, staffA, staffB, clientA, clientB, appA, appB };
}

describe("scope: who sees which applications", () => {
  it("staff only see applications assigned to them; admins see all", async () => {
    const w = await world();
    expect((await listAdminApplications(w.staffA)).total).toBe(0);
    expect((await listAdminApplications(w.admin)).total).toBe(2);
    expect((await listAdminApplications(w.root)).total).toBe(2);
    await assignApplication(w.admin, w.appA, w.staffA.id);
    const mine = await listAdminApplications(w.staffA);
    expect(mine.items.map((i) => i.id)).toEqual([w.appA]);
    expect((await listAdminApplications(w.staffB)).total).toBe(0);
    await expect(getManagedApplication(w.staffA, w.appB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAdminApplicationView(w.staffA, w.appB)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getAdminApplicationView(w.staffA, w.appA)).app.id).toBe(w.appA);
  });
  it("requires applications.view, and clients can never use the admin services", async () => {
    const w = await world();
    const noPerms = await makeUser("STAFF", "np@x.com");
    await expect(listAdminApplications(noPerms)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAdminApplicationView(noPerms, w.appA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAdminApplications(w.clientA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getManagedApplication(w.clientA, w.appA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getManagedApplication(null as never, w.appA)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("hides document data from staff without documents.view", async () => {
    const w = await world();
    const viewer = await makeUser("STAFF", "v@x.com", ["applications.view"]);
    await assignApplication(w.admin, w.appA, viewer.id).catch(() => undefined);
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: viewer.id } });
    const view = await getAdminApplicationView(viewer, w.appA);
    expect(view.documents).toEqual([]);
    expect(view.permissions).toMatchObject({ viewDocs: false, statusUpdate: false, assign: false, reviewDocs: false, addNotes: false });
  });
});

describe("list filters, search and pagination", () => {
  it("searches by name, email, phone and application number", async () => {
    const w = await world();
    const ids = async (q: string) => (await listAdminApplications(w.admin, { q })).items.map((i) => i.id);
    expect(await ids("ada")).toEqual([w.appA]);
    expect(await ids("BOB@x")).toEqual([w.appB]);
    expect(await ids("8022222")).toEqual([w.appB]);
    const number = (await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } })).applicationNumber;
    expect(await ids(number.toLowerCase())).toEqual([w.appA]);
    expect(await ids("nobody-matches")).toEqual([]);
  });
  it("filters by status, country, package, assignee and created date", async () => {
    const w = await world();
    await assignApplication(w.admin, w.appA, w.staffA.id);
    await changeApplicationStatus(w.admin, w.appB, { to: "UNDER_REVIEW" });
    const ids = async (f: Parameters<typeof listAdminApplications>[1]) => (await listAdminApplications(w.admin, f)).items.map((i) => i.id);
    expect(await ids({ status: "UNDER_REVIEW" })).toEqual([w.appB]);
    expect(await ids({ status: "APPLICATION_SUBMITTED" })).toEqual([w.appA]);
    expect(await ids({ assignee: "unassigned" })).toEqual([w.appB]);
    expect(await ids({ assignee: w.staffA.id })).toEqual([w.appA]);
    const adminAssigned = await listAdminApplications(w.staffA, { assignee: "me" });
    expect(adminAssigned.items.map((i) => i.id)).toEqual([w.appA]);
    expect((await ids({ country: "Canada" })).length).toBe(2);
    expect(await ids({ country: "France" })).toEqual([]);
    expect((await ids({ packageId: w.pkg.id })).length).toBe(2);
    expect(await ids({ from: "2999-01-01" })).toEqual([]);
    expect((await ids({ from: "2000-01-01", to: "2999-01-01" })).length).toBe(2);
  });
  it("paginates and reports totals", async () => {
    const w = await world();
    const p1 = await listAdminApplications(w.admin, { pageSize: 1, page: 1 });
    const p2 = await listAdminApplications(w.admin, { pageSize: 1, page: 2 });
    expect([p1.total, p1.pages, p1.items.length]).toEqual([2, 2, 1]);
    expect(p2.items[0]!.id).not.toBe(p1.items[0]!.id);
  });
  it("filter options only expose countries the actor can see", async () => {
    const w = await world();
    expect((await getApplicationFilterOptions(w.staffA)).countries).toEqual([]);
    expect((await getApplicationFilterOptions(w.admin)).countries).toEqual(["Canada"]);
  });
});

describe("changeApplicationStatus", () => {
  it("applies a legal transition and records history (with a client message) and audit", async () => {
    const w = await world();
    await changeApplicationStatus(w.admin, w.appA, { to: "UNDER_REVIEW", note: "We have started reviewing your application." });
    const app = await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA }, include: { statusHistory: { orderBy: { createdAt: "asc" } } } });
    expect(app.status).toBe("UNDER_REVIEW");
    const last = app.statusHistory.at(-1)!;
    expect(last).toMatchObject({ fromStatus: "APPLICATION_SUBMITTED", toStatus: "UNDER_REVIEW", changedById: w.admin.id, isOverride: false, note: "We have started reviewing your application." });
    expect(await db.auditLog.count({ where: { action: "application.status_changed" } })).toBe(1);
  });
  it("refuses illegal transitions unless overridden with a note, and flags overrides", async () => {
    const w = await world();
    await expect(changeApplicationStatus(w.admin, w.appA, { to: "APPROVED" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(changeApplicationStatus(w.admin, w.appA, { to: "APPROVED", override: true })).rejects.toMatchObject({ fieldErrors: { note: expect.any(Array) } });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } })).status).toBe("APPLICATION_SUBMITTED");
    await changeApplicationStatus(w.admin, w.appA, { to: "PROCESSING", override: true, note: "Fast-tracked after phone call" });
    const h = await db.applicationStatusHistory.findFirstOrThrow({ where: { applicationId: w.appA, toStatus: "PROCESSING" } });
    expect(h.isOverride).toBe(true);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "application.status_changed" } })).metadata).toMatchObject({ override: true });
  });
  it("protects drafts and terminal states", async () => {
    const w = await world();
    const { startApplication } = await import("@/lib/services/applications");
    const draft = await startApplication(await makeUser("CLIENT", "c3@x.com"), w.pkg.slug);
    // even the *normal* DRAFT -> SUBMITTED move is the client's alone (it validates the form)
    await expect(changeApplicationStatus(w.admin, draft.id, { to: "APPLICATION_SUBMITTED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeApplicationStatus(w.root, draft.id, { to: "APPLICATION_SUBMITTED", override: true, note: "skip the form" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeApplicationStatus(w.admin, draft.id, { to: "CANCELLED" }); // cancelling is a normal transition
    await expect(changeApplicationStatus(w.admin, draft.id, { to: "UNDER_REVIEW", override: true, note: "reopen please" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await changeApplicationStatus(w.root, draft.id, { to: "UNDER_REVIEW", override: true, note: "Reopened at client's request" });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("UNDER_REVIEW");
  });
  it("needs applications.status_update and respects scope", async () => {
    const w = await world();
    const viewer = await makeUser("STAFF", "v@x.com", ["applications.view"]);
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: viewer.id } });
    await expect(changeApplicationStatus(viewer, w.appA, { to: "UNDER_REVIEW" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeApplicationStatus(w.staffA, w.appA, { to: "UNDER_REVIEW" })).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned to staffA
    await expect(changeApplicationStatus(w.clientA, w.appA, { to: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } })).status).toBe("APPLICATION_SUBMITTED");
  });
  it("two concurrent changes cannot both win", async () => {
    const w = await world();
    const results = await Promise.allSettled([
      changeApplicationStatus(w.admin, w.appA, { to: "UNDER_REVIEW" }),
      changeApplicationStatus(w.admin, w.appA, { to: "UNDER_REVIEW" }),
      changeApplicationStatus(w.admin, w.appA, { to: "UNDER_REVIEW" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.applicationStatusHistory.count({ where: { applicationId: w.appA, toStatus: "UNDER_REVIEW" } })).toBe(1);
  });
});

describe("assignment", () => {
  it("assigns, reassigns and unassigns with audit; staff lose access when reassigned", async () => {
    const w = await world();
    await assignApplication(w.admin, w.appA, w.staffA.id);
    expect((await getManagedApplication(w.staffA, w.appA)).id).toBe(w.appA);
    await assignApplication(w.admin, w.appA, w.staffB.id);
    await expect(getManagedApplication(w.staffA, w.appA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await assignApplication(w.admin, w.appA, null);
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } })).assignedToId).toBeNull();
    expect(await db.auditLog.count({ where: { action: "application.assigned" } })).toBe(3);
  });
  it("rejects clients, inactive users and staff who cannot view applications as assignees", async () => {
    const w = await world();
    const inactive = await makeUser("STAFF", "in@x.com", STAFF_PERMS);
    await db.user.update({ where: { id: inactive.id }, data: { isActive: false } });
    const noView = await makeUser("STAFF", "nv@x.com", ["documents.view"]);
    for (const id of [w.clientA.id, inactive.id, noView.id, "does-not-exist"]) {
      await expect(assignApplication(w.admin, w.appA, id)).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });
  it("requires applications.assign", async () => {
    const w = await world();
    const viewer = await makeUser("STAFF", "v@x.com", ["applications.view", "applications.status_update"]);
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: viewer.id } });
    await expect(assignApplication(viewer, w.appA, w.staffA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("internal notes", () => {
  it("are staff-only: stored for staff, never part of the client's view", async () => {
    const w = await world();
    await addApplicationNote(w.admin, w.appA, "Client called; passport expires soon.");
    const staffView = await getAdminApplicationView(w.admin, w.appA);
    expect(staffView.notes.map((n) => n.body)).toEqual(["Client called; passport expires soon."]);
    const clientView = await getApplicationView(w.clientA, w.appA);
    expect(JSON.stringify(clientView)).not.toContain("passport expires soon");
    expect(clientView).not.toHaveProperty("notes");
    await expect(addApplicationNote(w.admin, w.appA, "   ")).rejects.toMatchObject({ code: "VALIDATION" });
    const viewer = await makeUser("STAFF", "v@x.com", ["applications.view"]);
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: viewer.id } });
    await expect(addApplicationNote(viewer, w.appA, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("document review workflow", () => {
  async function inReview() {
    const w = await world();
    await assignApplication(w.admin, w.appA, w.staffA.id);
    await changeApplicationStatus(w.staffA, w.appA, { to: "UNDER_REVIEW" });
    const doc = await db.applicationDocument.findFirstOrThrow({ where: { applicationId: w.appA, isCurrent: true } });
    return { ...w, doc };
  }

  it("approve: records reviewer and audit", async () => {
    const w = await inReview();
    await reviewDocument(w.staffA, w.doc.id, { action: "approve" });
    const d = await db.applicationDocument.findUniqueOrThrow({ where: { id: w.doc.id } });
    expect(d).toMatchObject({ status: "APPROVED", reviewedById: w.staffA.id, rejectionReason: null });
    expect(d.reviewedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "document.approved" } })).toBe(1);
  });
  it("requesting a replacement needs a reason, flags the document, and asks the client via the status", async () => {
    const w = await inReview();
    await expect(reviewDocument(w.staffA, w.doc.id, { action: "request_replacement" })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(Array) } });
    await reviewDocument(w.staffA, w.doc.id, { action: "request_replacement", reason: "Passport bio page is blurry" });
    const d = await db.applicationDocument.findUniqueOrThrow({ where: { id: w.doc.id } });
    expect(d).toMatchObject({ status: "REPLACEMENT_REQUIRED", rejectionReason: "Passport bio page is blurry" });
    const app = await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } });
    expect(app.status).toBe("DOCUMENTS_REQUIRED");
    const h = await db.applicationStatusHistory.findFirstOrThrow({ where: { applicationId: w.appA, toStatus: "DOCUMENTS_REQUIRED" } });
    expect(h.note).toContain("Passport bio page is blurry");
    expect(await db.auditLog.count({ where: { action: "document.replacement_requested" } })).toBe(1);
  });
  it("the client sees what to do, uploads a replacement, and the application returns to review", async () => {
    const w = await inReview();
    await reviewDocument(w.staffA, w.doc.id, { action: "request_replacement", reason: "Passport bio page is blurry" });

    const dash = await getClientDashboard(w.clientA);
    expect(dash.counts.documentsRequired).toBe(1);
    expect(dash.current).toMatchObject({ id: w.appA, action: { label: "Upload updated International passport", target: "documents", urgent: true } });
    expect(dash.current!.documentsToReplace[0]).toMatchObject({ rejectionReason: "Passport bio page is blurry", status: "REPLACEMENT_REQUIRED" });

    const replacement = await uploadDocument(w.clientA, { applicationId: w.appA, requirementKey: "international_passport", filename: "clear.pdf", bytes: PDF });
    expect(replacement).toMatchObject({ status: "UPLOADED", replacesId: w.doc.id });
    const app = await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } });
    expect(app.status).toBe("DOCUMENTS_UNDER_REVIEW");
    expect((await getClientDashboard(w.clientA)).counts.documentsRequired).toBe(0);
    // the superseded version can no longer be reviewed; the new one can
    await expect(reviewDocument(w.staffA, w.doc.id, { action: "approve" })).rejects.toMatchObject({ code: "VALIDATION" });
    await reviewDocument(w.staffA, replacement.id, { action: "approve" });
    await expect(uploadDocument(w.clientA, { applicationId: w.appA, requirementKey: "international_passport", filename: "x.pdf", bytes: PDF })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("a requested replacement can be uploaded even when the application is already processing, but nothing else can", async () => {
    const w = await inReview();
    await changeApplicationStatus(w.admin, w.appA, { to: "PROCESSING" });
    await expect(uploadDocument(w.clientA, { applicationId: w.appA, requirementKey: "international_passport", filename: "x.pdf", bytes: PDF })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reviewDocument(w.admin, w.doc.id, { action: "request_replacement", reason: "Expired passport" });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id: w.appA } })).status).toBe("PROCESSING"); // no automatic move out of processing
    expect((await uploadDocument(w.clientA, { applicationId: w.appA, requirementKey: "international_passport", filename: "new.pdf", bytes: PDF })).status).toBe("UPLOADED");
  });
  it("reject marks the document REJECTED with the reason", async () => {
    const w = await inReview();
    await reviewDocument(w.staffA, w.doc.id, { action: "reject", reason: "Not a passport" });
    expect(await db.applicationDocument.findUniqueOrThrow({ where: { id: w.doc.id } })).toMatchObject({ status: "REJECTED", rejectionReason: "Not a passport" });
    expect(await db.auditLog.count({ where: { action: "document.rejected" } })).toBe(1);
  });
  it("permission and scope: needs documents.review and an application inside the reviewer's scope", async () => {
    const w = await inReview();
    await expect(reviewDocument(w.staffB, w.doc.id, { action: "approve" })).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned to staffB
    const viewer = await makeUser("STAFF", "v@x.com", ["applications.view", "documents.view"]);
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: viewer.id } });
    await expect(reviewDocument(viewer, w.doc.id, { action: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewDocument(w.clientA, w.doc.id, { action: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.applicationDocument.findUniqueOrThrow({ where: { id: w.doc.id } })).status).toBe("UPLOADED");
  });
  it("staff document downloads respect permission (and are audited)", async () => {
    const w = await inReview();
    expect((await openDocument(w.staffA, w.doc.id)).doc.id).toBe(w.doc.id);
    expect(await db.auditLog.count({ where: { action: "document.downloaded", actorId: w.staffA.id } })).toBe(1);
  });
});

describe("client dashboard", () => {
  it("summarises counts, picks the application that needs action, and is isolated per client", async () => {
    const w = await world();
    const { startApplication } = await import("@/lib/services/applications");
    const draft = await startApplication(w.clientA, "canada-visa-assistance"); // second app for A: a fresh draft
    await changeApplicationStatus(w.admin, w.appA, { to: "UNDER_REVIEW" });
    const dashA = await getClientDashboard(w.clientA);
    expect(dashA.items).toHaveLength(2);
    expect(dashA.counts).toMatchObject({ active: 1, documentsRequired: 0, pendingPayments: 0, completed: 0 });
    expect(dashA.current).toMatchObject({ id: draft.id, action: { target: "wizard", urgent: true } }); // the draft needs the client
    await changeApplicationStatus(w.admin, w.appB, { to: "UNDER_REVIEW" });
    await changeApplicationStatus(w.admin, w.appB, { to: "PROCESSING" });
    await changeApplicationStatus(w.admin, w.appB, { to: "DECISION_PENDING" });
    await changeApplicationStatus(w.admin, w.appB, { to: "APPROVED" });
    await changeApplicationStatus(w.admin, w.appB, { to: "COMPLETED" });
    const dashB = await getClientDashboard(w.clientB);
    expect(dashB.counts).toMatchObject({ active: 0, completed: 1 });
    expect(dashB.current).toBeNull();
    expect(dashB.items.map((i) => i.id)).toEqual([w.appB]);
    expect(dashA.items.map((i) => i.id)).not.toContain(w.appB);
    await expect(getClientDashboard(w.admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("the client's history shows staff messages but not internal notes or other clients' data", async () => {
    const w = await world();
    await changeApplicationStatus(w.admin, w.appA, { to: "UNDER_REVIEW", note: "Reviewing now" });
    await addApplicationNote(w.admin, w.appA, "internal only");
    const view = await getApplicationView(w.clientA, w.appA);
    expect(view.history.map((h) => h.note)).toContain("Reviewing now");
    expect(JSON.stringify(view.history)).not.toContain("internal only");
    await expect(getApplicationView(w.clientB, w.appA)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
