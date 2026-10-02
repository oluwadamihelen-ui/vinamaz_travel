import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setEmailProviderForTests, type EmailMessage } from "@/lib/email/provider";
import { changeApplicationStatus, reviewDocument } from "@/lib/services/admin-applications";
import { startApplication, submitApplication } from "@/lib/services/applications";
import { registerClient } from "@/lib/services/users";
import { markAllNotificationsRead, listNotifications, markNotificationRead, unreadNotificationCount } from "@/lib/services/notifications";
import { sendMessage } from "@/lib/services/messages";
import { STAFF_PERMS, completeApplication, makeActivePackage, makePricedPackage, makeUser, resetDb, submittedApplication } from "./helpers";

let sent: EmailMessage[] = [];
beforeEach(async () => {
  await resetDb();
  sent = [];
  setEmailProviderForTests({ send: async (m) => { sent.push(m); } });
});

const reg = { name: "Ada Obi", email: "ada@example.com", phone: "+2348030000000", password: "longenough123", confirmPassword: "longenough123", countryOfResidence: "Nigeria" };
const subjects = () => sent.map((m) => m.subject);

describe("welcome email", () => {
  it("is sent on registration, and a mail failure never fails the registration", async () => {
    await registerClient(reg);
    expect(subjects()).toEqual(["Welcome to Vinamaz Travels"]);
    expect(await db.notification.count({ where: { type: "welcome" } })).toBe(1);
    setEmailProviderForTests({ send: async () => { throw new Error("mail down"); } });
    await expect(registerClient({ ...reg, email: "bob@example.com" })).resolves.toMatchObject({ email: "bob@example.com" });
    expect(await db.user.count({ where: { email: "bob@example.com" } })).toBe(1);
  });
});

describe("application lifecycle events", () => {
  it("submission emails the client (with a payment link when fees apply) and notifies assigned staff and admins", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com", []);
    const staff = await makeUser("STAFF", "s@x.com", [...STAFF_PERMS, "notifications.view"]);
    const pkg = await makePricedPackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const { id } = await startApplication(client, pkg.slug);
    await db.visaApplication.update({ where: { id }, data: { assignedToId: staff.id } });
    await completeApplication(client, id);
    sent = [];
    await submitApplication(client, id);
    const mail = sent.find((m) => m.subject.startsWith("Application received"))!;
    expect(mail.to).toBe("c@x.com");
    expect(mail.text).toContain("/client/payments/");
    const staffNotes = await db.notification.findMany({ where: { type: "application.submitted", userId: { in: [admin.id, staff.id] } } });
    expect(staffNotes.map((n) => n.userId).sort()).toEqual([admin.id, staff.id].sort());
    // an unassigned STAFF member is not told about someone else's application
    const other = await makeUser("STAFF", "o@x.com", [...STAFF_PERMS, "notifications.view"]);
    expect(await db.notification.count({ where: { userId: other.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "payment.created" } })).toBe(1);
  });

  it("status changes notify the client; 'more information' and 'completed' have their own emails; drafts and bookkeeping states don't email", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const pkg = await makeActivePackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const id = await submittedApplication(client, pkg.slug);
    sent = [];
    await changeApplicationStatus(admin, id, { to: "UNDER_REVIEW" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/Application update/);
    await changeApplicationStatus(admin, id, { to: "ADDITIONAL_INFORMATION_REQUIRED", note: "Please send a clearer scan" });
    expect(sent.at(-1)!.subject).toMatch(/More information needed/);
    expect(sent.at(-1)!.text).toContain("clearer scan");
    await changeApplicationStatus(admin, id, { to: "PROCESSING" });
    await changeApplicationStatus(admin, id, { to: "DECISION_PENDING" });
    await changeApplicationStatus(admin, id, { to: "APPROVED" });
    await changeApplicationStatus(admin, id, { to: "COMPLETED" });
    expect(sent.at(-1)!.subject).toMatch(/Application completed/);
    const notes = await db.notification.findMany({ where: { userId: client.id, type: { startsWith: "application.status." } } });
    expect(notes.length).toBe(6);
  });

  it("asking for a document replacement emails and notifies the client once", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const pkg = await makeActivePackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const id = await submittedApplication(client, pkg.slug);
    const doc = await db.applicationDocument.findFirstOrThrow({ where: { applicationId: id, isCurrent: true } });
    sent = [];
    await reviewDocument(admin, doc.id, { action: "request_replacement", reason: "The photo is blurry" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/Action needed: International passport/);
    expect(sent[0]!.text).toContain("blurry");
    expect(await db.notification.count({ where: { userId: client.id, type: "document.replacement_requested" } })).toBe(1);
  });

  it("a failing mail provider never breaks a committed status change", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const pkg = await makeActivePackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const id = await submittedApplication(client, pkg.slug);
    setEmailProviderForTests({ send: async () => { throw new Error("mail down"); } });
    await changeApplicationStatus(admin, id, { to: "UNDER_REVIEW" });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id } })).status).toBe("UNDER_REVIEW");
    expect(await db.notification.count({ where: { userId: client.id, type: "application.status.under_review" } })).toBe(1);
  });
});

describe("new-message notifications", () => {
  it("emails the client once for a burst of staff replies (deduped), but always notifies in-app", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const pkg = await makeActivePackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const id = await submittedApplication(client, pkg.slug);
    sent = [];
    await sendMessage(admin, id, { body: "First" });
    await sendMessage(admin, id, { body: "Second" });
    await sendMessage(admin, id, { body: "Third" });
    expect(sent.filter((m) => m.subject.startsWith("New message"))).toHaveLength(1);
    expect(sent[0]!.text).not.toContain("First"); // no message content in email
    expect(await db.notification.count({ where: { userId: client.id, type: "message.received" } })).toBe(3);
    // once the client has read them, a new reply emails again
    await db.applicationMessage.updateMany({ data: { readAt: new Date() } });
    await sendMessage(admin, id, { body: "Fourth" });
    expect(sent.filter((m) => m.subject.startsWith("New message"))).toHaveLength(2);
  });
  it("client messages notify the assigned staff and admins only", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const staff = await makeUser("STAFF", "s@x.com", [...STAFF_PERMS, "messages.view", "notifications.view"]);
    const stranger = await makeUser("STAFF", "x@x.com", [...STAFF_PERMS, "messages.view", "notifications.view"]);
    const pkg = await makeActivePackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const id = await submittedApplication(client, pkg.slug);
    await db.visaApplication.update({ where: { id }, data: { assignedToId: staff.id } });
    await sendMessage(client, id, { body: "Hello?" });
    const who = (await db.notification.findMany({ where: { type: "message.received" } })).map((n) => n.userId).sort();
    expect(who).toEqual([admin.id, staff.id].sort());
    expect(who).not.toContain(stranger.id);
  });
});

describe("in-app notifications are private to their owner", () => {
  it("lists, counts and marks read only the caller's own", async () => {
    const a = await makeUser("CLIENT", "a@x.com");
    const b = await makeUser("CLIENT", "b@x.com");
    const mine = await db.notification.create({ data: { userId: a.id, type: "t", title: "Mine", href: "/client/dashboard" } });
    await db.notification.create({ data: { userId: b.id, type: "t", title: "Theirs" } });
    expect((await listNotifications(a)).map((n) => n.title)).toEqual(["Mine"]);
    expect(await unreadNotificationCount(a)).toBe(1);
    await expect(markNotificationRead(b, mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await markNotificationRead(a, mine.id)).toEqual({ href: "/client/dashboard" });
    expect(await unreadNotificationCount(a)).toBe(0);
    await markAllNotificationsRead(b);
    expect(await unreadNotificationCount(a)).toBe(0);
    expect(await unreadNotificationCount(b)).toBe(0);
  });
});
