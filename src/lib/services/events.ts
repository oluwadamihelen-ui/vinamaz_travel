import "server-only";
import type { ApplicationStatus, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import type { Permission } from "@/lib/auth/permissions";
import { sendEmailSafely } from "@/lib/email/provider";
import {
  additionalInfoEmail, applicationCompletedEmail, applicationSubmittedEmail, documentReplacementEmail, newMessageEmail,
  paymentFailedEmail, paymentSuccessEmail, statusChangedEmail, welcomeEmail,
} from "@/lib/email/templates";
import { STATUS_LABEL } from "@/lib/applications/labels";
import { formatMinor } from "@/lib/payments/amounts";

/**
 * Business events -> in-app notifications + emails.
 *
 * Every function here is best-effort: it logs and swallows its own errors so a notification or mail
 * problem can never fail (or roll back) the operation that triggered it. Call them AFTER the
 * database transaction has committed.
 */

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function safely(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(`[events] ${label} failed:`, error instanceof Error ? error.message : error);
  }
}

interface NotificationInput { type: string; title: string; body?: string | null; href?: string | null; applicationId?: string | null }

export async function notifyUsers(userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  await db.notification.createMany({
    data: ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null, applicationId: n.applicationId ?? null })),
  });
}

/** Active staff who should hear about something on this application: its assignee plus admins, filtered by permission. */
export async function staffAudience(applicationId: string, permission: Permission): Promise<string[]> {
  const app = await db.visaApplication.findUnique({ where: { id: applicationId }, select: { assignedToId: true } });
  const users = await db.user.findMany({
    where: { isActive: true, OR: [{ role: { in: ["ADMIN", "SUPER_ADMIN"] } }, ...(app?.assignedToId ? [{ id: app.assignedToId }] : [])] },
    select: { id: true, role: true, permissions: true },
  });
  return users.filter((u) => can({ role: u.role as Role, permissions: u.permissions }, permission)).map((u) => u.id);
}

async function clientOf(applicationId: string) {
  return db.visaApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, applicationNumber: true, packageName: true, status: true, clientId: true, client: { select: { id: true, name: true, email: true } } },
  });
}

const clientAppLink = (id: string) => `${appUrl()}/client/applications/${id}`;
const adminAppLink = (id: string) => `/admin/applications/${id}`;

// --- Accounts --------------------------------------------------------------

export function onClientRegistered(user: { id: string; name: string; email: string }) {
  return safely("welcome", async () => {
    await notifyUsers([user.id], { type: "welcome", title: "Welcome to Vinamaz Travels", body: "Browse packages and start your first application.", href: "/packages" });
    await sendEmailSafely({ to: user.email, ...welcomeEmail({ name: user.name, link: `${appUrl()}/client/dashboard` }) });
  });
}

// --- Applications ----------------------------------------------------------

export function onApplicationSubmitted(applicationId: string, paymentId: string | null) {
  return safely("application submitted", async () => {
    const app = await clientOf(applicationId);
    if (!app) return;
    const link = paymentId ? `${appUrl()}/client/payments/${paymentId}` : clientAppLink(app.id);
    await notifyUsers([app.client.id], { type: "application.submitted", title: `Application ${app.applicationNumber} received`, body: paymentId ? "Complete payment to start the review." : "We'll review it and be in touch.", href: `/client/applications/${app.id}`, applicationId: app.id });
    await sendEmailSafely({ to: app.client.email, ...applicationSubmittedEmail({ name: app.client.name, applicationNumber: app.applicationNumber, packageName: app.packageName, link, paymentDue: !!paymentId }) });
    await notifyUsers(await staffAudience(app.id, "applications.view"), { type: "application.submitted", title: `New application ${app.applicationNumber}`, body: `${app.client.name} · ${app.packageName}`, href: adminAppLink(app.id), applicationId: app.id });
  });
}

export function onStatusChanged(applicationId: string, to: ApplicationStatus, note: string | null) {
  return safely("status changed", async () => {
    const app = await clientOf(applicationId);
    if (!app) return;
    const href = `/client/applications/${app.id}`;
    const label = STATUS_LABEL[to];
    await notifyUsers([app.client.id], { type: `application.status.${to.toLowerCase()}`, title: `Application ${app.applicationNumber}: ${label}`, body: note, href, applicationId: app.id });
    // Do not email on bookkeeping moves the client already triggered or can't act on.
    if (to === "COMPLETED") {
      await sendEmailSafely({ to: app.client.email, ...applicationCompletedEmail({ name: app.client.name, applicationNumber: app.applicationNumber, packageName: app.packageName, link: clientAppLink(app.id) }) });
    } else if (to === "ADDITIONAL_INFORMATION_REQUIRED") {
      await sendEmailSafely({ to: app.client.email, ...additionalInfoEmail({ name: app.client.name, applicationNumber: app.applicationNumber, note, link: clientAppLink(app.id) }) });
    } else if (to !== "DRAFT" && to !== "APPLICATION_SUBMITTED" && to !== "PAYMENT_PENDING" && to !== "PAYMENT_CONFIRMED" && to !== "DOCUMENTS_UNDER_REVIEW") {
      await sendEmailSafely({ to: app.client.email, ...statusChangedEmail({ name: app.client.name, applicationNumber: app.applicationNumber, statusLabel: label, note, link: clientAppLink(app.id) }) });
    }
  });
}

export function onDocumentReplacementRequested(applicationId: string, documentName: string, reason: string | null, replacement: boolean) {
  return safely("document replacement", async () => {
    const app = await clientOf(applicationId);
    if (!app) return;
    await notifyUsers([app.client.id], { type: "document.replacement_requested", title: `${documentName}: new copy needed`, body: reason, href: `/client/applications/${app.id}`, applicationId: app.id });
    await sendEmailSafely({ to: app.client.email, ...documentReplacementEmail({ name: app.client.name, applicationNumber: app.applicationNumber, documentName, reason, replacement, link: clientAppLink(app.id) }) });
  });
}

export function onDocumentUploaded(applicationId: string, documentName: string) {
  return safely("document uploaded", async () => {
    const app = await clientOf(applicationId);
    if (!app || app.status === "DRAFT") return;
    await notifyUsers(await staffAudience(app.id, "documents.view"), { type: "document.uploaded", title: `${app.applicationNumber}: ${documentName} uploaded`, body: app.client.name, href: adminAppLink(app.id), applicationId: app.id });
  });
}

// --- Payments --------------------------------------------------------------

export function onPaymentSucceeded(paymentId: string) {
  return safely("payment succeeded", async () => {
    const p = await db.payment.findUnique({ where: { id: paymentId }, include: { application: { select: { id: true, applicationNumber: true, packageName: true } }, client: { select: { id: true, name: true, email: true } } } });
    if (!p) return;
    const amount = formatMinor(p.amountMinor, p.currency);
    await notifyUsers([p.client.id], { type: "payment.confirmed", title: `Payment received · ${amount}`, body: `Reference ${p.reference}`, href: `/client/payments/${p.id}`, applicationId: p.application.id });
    await sendEmailSafely({ to: p.client.email, ...paymentSuccessEmail({ name: p.client.name, reference: p.reference, amount, applicationNumber: p.application.applicationNumber, packageName: p.application.packageName, link: `${appUrl()}/client/payments/${p.id}` }) });
    await notifyUsers(await staffAudience(p.application.id, "payments.view"), { type: "payment.confirmed", title: `Payment received · ${amount}`, body: `${p.application.applicationNumber} · ${p.client.name}`, href: `/admin/payments/${p.id}`, applicationId: p.application.id });
  });
}

export function onPaymentFailed(paymentId: string, reason: string | null) {
  return safely("payment failed", async () => {
    const p = await db.payment.findUnique({ where: { id: paymentId }, include: { application: { select: { id: true, applicationNumber: true } }, client: { select: { id: true, name: true, email: true } } } });
    if (!p) return;
    const amount = formatMinor(p.amountMinor, p.currency);
    await notifyUsers([p.client.id], { type: "payment.failed", title: "Payment unsuccessful", body: reason ?? `Reference ${p.reference}`, href: `/client/payments/${p.id}`, applicationId: p.application.id });
    await sendEmailSafely({ to: p.client.email, ...paymentFailedEmail({ name: p.client.name, reference: p.reference, amount, applicationNumber: p.application.applicationNumber, reason, link: `${appUrl()}/client/payments/${p.id}` }) });
  });
}

export function onProofSubmitted(paymentId: string) {
  return safely("proof submitted", async () => {
    const p = await db.payment.findUnique({ where: { id: paymentId }, include: { application: { select: { id: true, applicationNumber: true } }, client: { select: { name: true } } } });
    if (!p) return;
    await notifyUsers(await staffAudience(p.application.id, "payments.manage"), { type: "payment.review_needed", title: "Transfer receipt to review", body: `${p.application.applicationNumber} · ${p.client.name}`, href: `/admin/payments/${p.id}`, applicationId: p.application.id });
  });
}

/** Payments held for a person to decide (amount mismatch etc.). */
export function onPaymentNeedsReview(paymentId: string) {
  return onProofSubmitted(paymentId);
}

// --- Messages --------------------------------------------------------------

export function onMessageSent(messageId: string) {
  return safely("message sent", async () => {
    const m = await db.applicationMessage.findUnique({ where: { id: messageId }, include: { application: { select: { id: true, applicationNumber: true, clientId: true, client: { select: { name: true, email: true } } } } } });
    if (!m) return;
    const app = m.application;
    if (m.senderRole === "CLIENT") {
      const ids = await staffAudience(app.id, "messages.view");
      await notifyUsers(ids, { type: "message.received", title: `New message · ${app.applicationNumber}`, body: app.client.name, href: `/admin/applications/${app.id}#messages`, applicationId: app.id });
      return;
    }
    await notifyUsers([app.clientId], { type: "message.received", title: `New message about ${app.applicationNumber}`, body: "Open your application to read it.", href: `/client/applications/${app.id}#messages`, applicationId: app.id });
    // Email dedupe: only email when this is the first unread staff message in the thread, so a burst of
    // replies produces a single email rather than one per message.
    const earlierUnread = await db.applicationMessage.count({ where: { applicationId: app.id, senderRole: { not: "CLIENT" }, readAt: null, id: { not: m.id }, createdAt: { lt: m.createdAt } } });
    if (earlierUnread === 0) {
      await sendEmailSafely({ to: app.client.email, ...newMessageEmail({ name: app.client.name, applicationNumber: app.applicationNumber, senderLabel: "The Vinamaz team", preview: "", link: `${clientAppLink(app.id)}#messages`, staff: false }) });
    }
  });
}
