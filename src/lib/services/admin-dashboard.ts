import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/actor";
import { AppError } from "@/lib/errors";
import { applicationScope } from "./admin-applications";
import { listConversations } from "./messages";

/**
 * Everything on the admin dashboard is computed from real records and filtered by what the viewer may see:
 * sections the viewer has no permission for are simply absent, and staff only ever count applications assigned to them.
 */
export async function getAdminDashboard(actor: Actor) {
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  const scope = applicationScope(actor);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const canApps = can(actor, "applications.view");
  const canPay = can(actor, "payments.view");
  const canDocs = can(actor, "documents.view");
  const canMsgs = can(actor, "messages.view");
  const canClients = can(actor, "clients.view");
  const canPkgs = can(actor, "packages.view") || canApps;

  const appWhere: Prisma.VisaApplicationWhereInput = { ...scope, status: { not: "DRAFT" } };
  const paymentScope: Prisma.PaymentWhereInput = { application: scope };

  const [apps, payments, action, recentApps, recentPayments, conversations, clients, packages] = await Promise.all([
    canApps ? applicationStats(appWhere, monthStart) : null,
    canPay ? paymentStats(paymentScope, monthStart) : null,
    actionRequired(actor, { scope, paymentScope, canApps, canPay, canDocs, canMsgs }),
    canApps
      ? db.visaApplication.findMany({ where: appWhere, orderBy: { submittedAt: "desc" }, take: 8, select: { id: true, applicationNumber: true, packageName: true, status: true, submittedAt: true, client: { select: { name: true } } } })
      : [],
    canPay
      ? db.payment.findMany({ where: { ...paymentScope }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, reference: true, amountMinor: true, currency: true, status: true, method: true, createdAt: true, application: { select: { applicationNumber: true } }, client: { select: { name: true } } } })
      : [],
    canMsgs ? listConversations(actor, { limit: 6 }) : [],
    canClients ? clientStats(monthStart) : null,
    canPkgs ? packagePerformance(scope) : [],
  ]);
  return { apps, payments, action, recentApps, recentPayments, conversations, clients, packages };
}

async function applicationStats(where: Prisma.VisaApplicationWhereInput, monthStart: Date) {
  const [byStatus, thisMonth] = await Promise.all([
    db.visaApplication.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.visaApplication.count({ where: { ...where, submittedAt: { gte: monthStart } } }),
  ]);
  const count = (...s: string[]) => byStatus.filter((r) => s.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
  return {
    total: byStatus.reduce((n, r) => n + r._count._all, 0),
    thisMonth,
    awaitingPayment: count("PAYMENT_PENDING"),
    inReview: count("APPLICATION_SUBMITTED", "PAYMENT_CONFIRMED", "UNDER_REVIEW", "DOCUMENTS_UNDER_REVIEW"),
    awaitingClient: count("DOCUMENTS_REQUIRED", "ADDITIONAL_INFORMATION_REQUIRED"),
    processing: count("PROCESSING", "SUBMITTED_TO_AUTHORITY", "DECISION_PENDING"),
    approved: count("APPROVED"),
    refused: count("REFUSED"),
    completed: count("COMPLETED"),
    cancelled: count("CANCELLED"),
  };
}

async function paymentStats(scope: Prisma.PaymentWhereInput, monthStart: Date) {
  const paid = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
  const [all, month] = await Promise.all([
    db.payment.groupBy({ by: ["currency"], where: { ...scope, status: { in: [...paid] } }, _sum: { amountMinor: true, refundedAmountMinor: true }, _count: { _all: true } }),
    db.payment.groupBy({ by: ["currency"], where: { ...scope, status: { in: [...paid] }, paidAt: { gte: monthStart } }, _sum: { amountMinor: true, refundedAmountMinor: true } }),
  ]);
  const net = (r: { _sum: { amountMinor: number | null; refundedAmountMinor: number | null } }) => (r._sum.amountMinor ?? 0) - (r._sum.refundedAmountMinor ?? 0);
  const monthBy = new Map(month.map((m) => [m.currency, net(m)]));
  return all.map((r) => ({ currency: r.currency, payments: r._count._all, netMinor: net(r), thisMonthMinor: monthBy.get(r.currency) ?? 0 }));
}

async function clientStats(monthStart: Date) {
  const [total, thisMonth] = await Promise.all([
    db.user.count({ where: { role: "CLIENT" } }),
    db.user.count({ where: { role: "CLIENT", createdAt: { gte: monthStart } } }),
  ]);
  return { total, thisMonth };
}

async function packagePerformance(scope: Prisma.VisaApplicationWhereInput) {
  const rows = await db.visaApplication.groupBy({ by: ["packageId", "packageName", "status"], where: scope, _count: { _all: true } });
  const by = new Map<string, { packageId: string; name: string; started: number; submitted: number; approved: number; completed: number; refused: number }>();
  for (const r of rows) {
    const e = by.get(r.packageId) ?? { packageId: r.packageId, name: r.packageName, started: 0, submitted: 0, approved: 0, completed: 0, refused: 0 };
    const n = r._count._all;
    e.started += n;
    if (r.status !== "DRAFT") e.submitted += n;
    if (r.status === "APPROVED") e.approved += n;
    if (r.status === "COMPLETED") e.completed += n;
    if (r.status === "REFUSED") e.refused += n;
    by.set(r.packageId, e);
  }
  return [...by.values()].sort((a, b) => b.submitted - a.submitted).slice(0, 10);
}

async function actionRequired(
  actor: Actor,
  o: { scope: Prisma.VisaApplicationWhereInput; paymentScope: Prisma.PaymentWhereInput; canApps: boolean; canPay: boolean; canDocs: boolean; canMsgs: boolean },
) {
  const items: { key: string; label: string; count: number; href: string }[] = [];
  const add = (key: string, label: string, count: number, href: string) => { if (count > 0) items.push({ key, label, count, href }); };
  const canAll = actor.role === "ADMIN" || actor.role === "SUPER_ADMIN";
  const [unassigned, docs, transfers, held, unread] = await Promise.all([
    o.canApps && canAll && can(actor, "applications.assign")
      ? db.visaApplication.count({ where: { status: { in: ["APPLICATION_SUBMITTED", "PAYMENT_CONFIRMED", "UNDER_REVIEW"] }, assignedToId: null } }) : 0,
    o.canDocs && can(actor, "documents.review")
      ? db.applicationDocument.count({ where: { isCurrent: true, status: { in: ["UPLOADED", "UNDER_REVIEW"] }, application: { ...o.scope, status: { not: "DRAFT" } } } }) : 0,
    o.canPay && can(actor, "payments.manage") ? db.payment.count({ where: { ...o.paymentScope, method: "BANK_TRANSFER", status: "PROCESSING" } }) : 0,
    o.canPay && can(actor, "payments.manage") ? db.payment.count({ where: { ...o.paymentScope, method: { not: "BANK_TRANSFER" }, status: "PROCESSING" } }) : 0,
    o.canMsgs ? db.applicationMessage.count({ where: { senderRole: "CLIENT", readAt: null, application: o.scope } }) : 0,
  ]);
  add("unassigned", "Applications waiting to be assigned", unassigned, "/admin/applications?assignee=unassigned");
  add("documents", "Documents waiting for review", docs, "/admin/applications");
  add("transfers", "Bank transfers to confirm", transfers, "/admin/payments?status=PROCESSING&method=BANK_TRANSFER");
  add("held", "Online payments held for review", held, "/admin/payments?status=PROCESSING");
  add("messages", "Unread client messages", unread, "/admin/messages");
  return items;
}
