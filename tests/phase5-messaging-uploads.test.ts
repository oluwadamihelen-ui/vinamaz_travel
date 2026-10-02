import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setEmailProviderForTests } from "@/lib/email/provider";
import { resetRateLimits } from "@/lib/rate-limit";
import { clientUnreadByApplication, listConversations, listMessages, markConversationRead, openMessageAttachment, sendMessage, staffUnreadCount } from "@/lib/services/messages";
import { authorizeBlobUpload, completeUpload, initUpload, purgeStaleUploads, receiveDirectUpload } from "@/lib/services/uploads";
import { getPrivateStorage } from "@/lib/storage/private-documents";
import { PDF, PNG, STAFF_PERMS, makeActivePackage, makePricedPackage, makeUser, resetDb, submittedApplication } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await resetRateLimits();
  setEmailProviderForTests({ send: async () => undefined });
});

async function world() {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const staff = await makeUser("STAFF", "s@x.com", [...STAFF_PERMS, "messages.view", "messages.manage"]);
  const readOnly = await makeUser("STAFF", "ro@x.com", [...STAFF_PERMS, "messages.view"]);
  const pkg = await makeActivePackage(admin);
  const a = await makeUser("CLIENT", "a@x.com");
  const b = await makeUser("CLIENT", "b@x.com");
  const appA = await submittedApplication(a, pkg.slug);
  const appB = await submittedApplication(b, pkg.slug);
  // documents can be uploaded while the application is waiting on the client
  await db.visaApplication.update({ where: { id: appA }, data: { assignedToId: staff.id, status: "DOCUMENTS_REQUIRED" } });
  return { admin, staff, readOnly, a, b, appA, appB };
}

/** Run the whole upload flow in local mode, as the browser would. */
async function upload(actor: Parameters<typeof initUpload>[0], input: Parameters<typeof initUpload>[1], bytes: Buffer, extra = {}) {
  const slot = await initUpload(actor, input);
  await receiveDirectUpload(actor, slot.uploadId, bytes);
  return { slot, done: await completeUpload(actor, slot.uploadId, extra) };
}

describe("messaging authorisation", () => {
  it("clients only ever reach their own conversations; other ids look missing", async () => {
    const w = await world();
    await sendMessage(w.a, w.appA, { body: "Hello" });
    await expect(sendMessage(w.b, w.appA, { body: "Hi" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listMessages(w.b, w.appA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(markConversationRead(w.b, w.appA)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(sendMessage(w.a, "nope", { body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("staff need messages.view/manage AND the application in their scope", async () => {
    const w = await world();
    await sendMessage(w.a, w.appA, { body: "Question" });
    expect((await listMessages(w.staff, w.appA))[0]!.body).toBe("Question");
    await expect(listMessages(w.staff, w.appB)).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned
    await expect(sendMessage(w.staff, w.appB, { body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listMessages(w.readOnly, w.appA)).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned to read-only user
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: w.readOnly.id } });
    await expect(listMessages(w.readOnly, w.appA)).resolves.toHaveLength(1);
    await expect(sendMessage(w.readOnly, w.appA, { body: "no" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const noPerm = await makeUser("STAFF", "np@x.com", ["applications.view"]);
    await expect(listMessages(noPerm, w.appA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sendMessage(w.admin, w.appB, { body: "Admins see everything" })).resolves.toBeTruthy();
  });
  it("validates content, blocks drafts, and rate-limits bursts", async () => {
    const w = await world();
    await expect(sendMessage(w.a, w.appA, { body: "   " })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(sendMessage(w.a, w.appA, { body: "x".repeat(4001) })).rejects.toMatchObject({ code: "VALIDATION" });
    const pkg = await makeActivePackage(w.admin, "Another Package");
    const { startApplication } = await import("@/lib/services/applications");
    const { id: draft } = await startApplication(w.a, pkg.slug);
    await expect(sendMessage(w.a, draft, { body: "hi" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (let i = 0; i < 30; i++) await sendMessage(w.a, w.appA, { body: `m${i}` });
    await expect(sendMessage(w.a, w.appA, { body: "one too many" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("unread tracking", () => {
  it("each side only marks what the OTHER side sent as read", async () => {
    const w = await world();
    await sendMessage(w.a, w.appA, { body: "From client" });
    await sendMessage(w.staff, w.appA, { body: "From staff 1" });
    await sendMessage(w.staff, w.appA, { body: "From staff 2" });
    expect((await clientUnreadByApplication(w.a)).get(w.appA)).toBe(2);
    expect(await staffUnreadCount(w.staff)).toBe(1);
    expect(await staffUnreadCount(w.readOnly)).toBe(0); // out of scope
    expect(await staffUnreadCount(w.admin)).toBe(1);
    expect(await markConversationRead(w.a, w.appA)).toBe(2);
    expect((await clientUnreadByApplication(w.a)).get(w.appA)).toBeUndefined();
    expect(await staffUnreadCount(w.staff)).toBe(1); // the client reading doesn't mark the client's own message read
    await markConversationRead(w.staff, w.appA);
    expect(await staffUnreadCount(w.staff)).toBe(0);
  });
  it("clients see 'Vinamaz Travels', not a staff member's name", async () => {
    const w = await world();
    await sendMessage(w.staff, w.appA, { body: "Hi" });
    expect((await listMessages(w.a, w.appA))[0]!.senderName).toBe("Vinamaz Travels");
    expect((await listMessages(w.staff, w.appA))[0]!.senderName).toBe("s");
  });
  it("the staff inbox lists only in-scope conversations, unread first", async () => {
    const w = await world();
    await sendMessage(w.a, w.appA, { body: "A says hi" });
    await sendMessage(w.b, w.appB, { body: "B says hi" });
    expect((await listConversations(w.staff)).map((c) => c.applicationId)).toEqual([w.appA]);
    const all = await listConversations(w.admin);
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.unread === 1)).toBe(true);
  });
});

describe("direct upload pipeline (local storage mode)", () => {
  it("document: server chooses the key, checks the bytes, and attaches the file", async () => {
    const w = await world();
    const { slot, done } = await upload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "statement.pdf", size: PDF.length }, PDF);
    expect(slot.storageKey).toMatch(new RegExp(`^applications/${w.appA}/[a-f0-9-]{36}\\.pdf$`));
    const doc = await db.applicationDocument.findFirstOrThrow({ where: { applicationId: w.appA, requirementKey: "bank_statement" } });
    expect(doc).toMatchObject({ storageKey: slot.storageKey, status: "UPLOADED", isCurrent: true, mimeType: "application/pdf" });
    expect(done).toMatchObject({ documentId: doc.id });
    expect(await db.auditLog.count({ where: { action: "document.uploaded" } })).toBeGreaterThan(0);
  });
  it("can't authorise uploads to someone else's application, an unknown slot, or a disallowed type/size", async () => {
    const w = await world();
    const base = { kind: "DOCUMENT" as const, applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: 10 };
    await expect(initUpload(w.b, base)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(initUpload(w.a, { ...base, requirementKey: "../../etc/passwd" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(initUpload(w.a, { ...base, filename: "virus.exe" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(initUpload(w.a, { ...base, size: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(initUpload(w.a, { ...base, size: 26 * 1024 * 1024 })).rejects.toThrow(/too large/);
  });
  it("enforces the per-slot size cap", async () => {
    const w = await world();
    await expect(initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: 11 * 1024 * 1024 })).rejects.toThrow(/too large/);
  });
  it("a slot belongs to its creator and can be used once", async () => {
    const w = await world();
    const slot = await initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: PDF.length });
    await expect(receiveDirectUpload(w.b, slot.uploadId, PDF)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(completeUpload(w.b, slot.uploadId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeBlobUpload(w.b, slot.uploadId, slot.storageKey)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(authorizeBlobUpload(w.a, slot.uploadId, "applications/other/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeBlobUpload(w.a, slot.uploadId, slot.storageKey)).resolves.toMatchObject({ maxBytes: 10 * 1024 * 1024 });
    await receiveDirectUpload(w.a, slot.uploadId, PDF);
    await completeUpload(w.a, slot.uploadId);
    await expect(completeUpload(w.a, slot.uploadId)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(receiveDirectUpload(w.a, slot.uploadId, PDF)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("re-checks the stored bytes: a spoofed type is rejected and the file is deleted", async () => {
    const w = await world();
    const slot = await initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: PNG.length });
    const storage = getPrivateStorage();
    await storage.put(slot.storageKey, Buffer.from("MZ not really a pdf at all"), "application/pdf"); // bypasses our direct route, as a hostile client could
    await expect(completeUpload(w.a, slot.uploadId)).rejects.toThrow(/valid PDF, JPG or PNG/);
    expect(await storage.inspect(slot.storageKey)).toBeNull();
    expect(await db.applicationDocument.count({ where: { requirementKey: "bank_statement" } })).toBe(0);
    // a PNG uploaded under a .pdf slot is also refused
    const slot2 = await initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: PNG.length });
    await storage.put(slot2.storageKey, PNG, "image/png");
    await expect(completeUpload(w.a, slot2.uploadId)).rejects.toThrow(/valid PDF, JPG or PNG/);
  });
  it("a file that never arrived can be retried; an expired slot cannot", async () => {
    const w = await world();
    const slot = await initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: PDF.length });
    await expect(completeUpload(w.a, slot.uploadId)).rejects.toThrow(/didn't finish uploading/);
    await receiveDirectUpload(w.a, slot.uploadId, PDF);
    await expect(completeUpload(w.a, slot.uploadId)).resolves.toBeTruthy();
    await db.applicationDocument.updateMany({ where: { applicationId: w.appA }, data: { status: "REJECTED" } });
    const old = await initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "y.pdf", size: PDF.length });
    await db.pendingUpload.update({ where: { id: old.uploadId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    await expect(receiveDirectUpload(w.a, old.uploadId, PDF)).rejects.toThrow(/expired/);
    await expect(authorizeBlobUpload(w.a, old.uploadId, old.storageKey)).rejects.toThrow(/expired/);
  });
  it("housekeeping removes abandoned slots and their stray files", async () => {
    const w = await world();
    const slot = await initUpload(w.a, { kind: "DOCUMENT", applicationId: w.appA, requirementKey: "bank_statement", filename: "x.pdf", size: PDF.length });
    await receiveDirectUpload(w.a, slot.uploadId, PDF);
    await db.pendingUpload.update({ where: { id: slot.uploadId }, data: { expiresAt: new Date(Date.now() - 3600_000) } });
    await purgeStaleUploads();
    expect(await db.pendingUpload.count()).toBe(0);
    expect(await getPrivateStorage().inspect(slot.storageKey)).toBeNull();
  });
  it("payment proof: client-only, validated fields BEFORE the slot is consumed, then payment moves to review", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const pkg = await makePricedPackage(admin);
    const a = await makeUser("CLIENT", "a@x.com");
    const b = await makeUser("CLIENT", "b@x.com");
    const app = await submittedApplication(a, pkg.slug);
    const payment = await db.payment.findFirstOrThrow({ where: { applicationId: app } });
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const { saveBankAccount } = await import("@/lib/services/payment-settings");
    await saveBankAccount(root, null, { bankName: "Test Bank", accountName: "Vinamaz Travels", accountNumber: "0123456789", currency: "NGN", isActive: true });
    const { chooseBankTransfer } = await import("@/lib/services/payments");
    await chooseBankTransfer(a, payment.id);
    await expect(initUpload(b, { kind: "PAYMENT_PROOF", paymentId: payment.id, filename: "r.pdf", size: PDF.length })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const slot = await initUpload(a, { kind: "PAYMENT_PROOF", paymentId: payment.id, filename: "receipt.pdf", size: PDF.length });
    expect(slot.storageKey).toMatch(new RegExp(`^payments/${payment.id}/`));
    await receiveDirectUpload(a, slot.uploadId, PDF);
    await expect(completeUpload(a, slot.uploadId, { senderName: "", transferDate: "2026-01-05" })).rejects.toMatchObject({ code: "VALIDATION" });
    // still usable after fixing the fields
    await expect(completeUpload(a, slot.uploadId, { senderName: "Ada Obi", transferDate: "2026-01-05" })).resolves.toMatchObject({ kind: "PAYMENT_PROOF" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "PROCESSING", proofStorageKey: slot.storageKey, senderName: "Ada Obi" });
    expect(await db.notification.count({ where: { userId: admin.id, type: "payment.review_needed" } })).toBe(1);
  });
  it("message attachments: only the uploader's completed, unused uploads for THAT application can be sent", async () => {
    const w = await world();
    const { slot } = await upload(w.a, { kind: "MESSAGE_ATTACHMENT", applicationId: w.appA, filename: "id-card.png", size: PNG.length }, PNG);
    expect(slot.storageKey).toMatch(/^messages\//);
    const unfinished = await initUpload(w.a, { kind: "MESSAGE_ATTACHMENT", applicationId: w.appA, filename: "later.pdf", size: PDF.length });
    await expect(sendMessage(w.a, w.appA, { body: "x", uploadIds: [unfinished.uploadId] })).rejects.toMatchObject({ code: "VALIDATION" }); // not completed
    await expect(sendMessage(w.b, w.appB, { body: "x", uploadIds: [slot.uploadId] })).rejects.toMatchObject({ code: "VALIDATION" }); // someone else's
    const { slot: forB } = await upload(w.b, { kind: "MESSAGE_ATTACHMENT", applicationId: w.appB, filename: "b.png", size: PNG.length }, PNG);
    await expect(sendMessage(w.a, w.appA, { body: "x", uploadIds: [forB.uploadId] })).rejects.toMatchObject({ code: "VALIDATION" });
    const msg = await sendMessage(w.a, w.appA, { body: "", uploadIds: [slot.uploadId] }); // attachment-only is fine
    await expect(sendMessage(w.a, w.appA, { body: "again", uploadIds: [slot.uploadId] })).rejects.toMatchObject({ code: "CONFLICT" }); // single use
    const att = await db.applicationMessageAttachment.findFirstOrThrow({ where: { messageId: msg.id } });
    expect(att).toMatchObject({ filename: "id-card.png", mimeType: "image/png" });
    // downloads: participants only
    const open = await openMessageAttachment(w.a, att.id);
    expect(open.att.id).toBe(att.id);
    await expect(openMessageAttachment(w.b, att.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(openMessageAttachment(null, att.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(openMessageAttachment(w.readOnly, att.id)).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) });
    await expect(openMessageAttachment(w.staff, att.id)).resolves.toBeTruthy();
    expect(await db.auditLog.count({ where: { action: "message.attachment_downloaded" } })).toBe(1);
  });
});
