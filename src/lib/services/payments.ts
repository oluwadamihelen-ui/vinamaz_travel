import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireClient, requirePermission, type Actor } from "@/lib/auth/actor";
import { sendEmailSafely } from "@/lib/email/provider";
import { paymentSuccessEmail } from "@/lib/email/templates";
import { MIME_BY_FORMAT, MAX_SERVER_UPLOAD_BYTES, safeFilename, sniffFormat } from "@/lib/applications/files";
import { rateLimit } from "@/lib/rate-limit";
import { formatMinor, type LineItem } from "@/lib/payments/amounts";
import { createPaymentRow } from "@/lib/payments/create";
import { GATEWAY_METHODS, getGateway } from "@/lib/payments/registry";
import type { GatewayMethod } from "@/lib/payments/types";
import { getPrivateStorage, newPaymentProofKey } from "@/lib/storage/private-documents";
import { applicationScope } from "./admin-applications";
import { recordAudit } from "./audit";

const OPEN: PaymentStatus[] = ["PENDING", "FAILED", "CANCELLED"];
const PAID: PaymentStatus[] = ["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"];

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Which methods can this payment use?
// ---------------------------------------------------------------------------

export interface AvailableMethod { method: PaymentMethod; label: string }

export async function getAvailableMethods(currency: string): Promise<AvailableMethod[]> {
  const [settings, banks] = await Promise.all([
    db.paymentMethodSetting.findMany(),
    db.bankAccount.count({ where: { isActive: true, currency } }),
  ]);
  const disabled = new Set(settings.filter((s) => !s.enabled).map((s) => s.method));
  const out: AvailableMethod[] = [];
  for (const m of GATEWAY_METHODS) {
    const g = getGateway(m)!;
    if (g.isConfigured() && g.supportsCurrency(currency) && !disabled.has(m)) out.push({ method: m, label: g.label });
  }
  if (banks > 0 && !disabled.has("BANK_TRANSFER")) out.push({ method: "BANK_TRANSFER", label: "Bank transfer" });
  return out;
}

// ---------------------------------------------------------------------------
// Reading (client side: strictly ownership-scoped)
// ---------------------------------------------------------------------------

/** Load a payment only if it belongs to the acting client; other ids look like missing ones. */
export async function getOwnedPayment(actor: Actor, paymentId: string) {
  requireClient(actor);
  const payment = await db.payment.findFirst({ where: { id: paymentId, clientId: actor.id } });
  if (!payment) throw new AppError("We couldn't find that payment.", "NOT_FOUND");
  return payment;
}

export async function getClientPaymentView(actor: Actor, paymentId: string) {
  const payment = await getOwnedPayment(actor, paymentId);
  const [application, methods, banks] = await Promise.all([
    db.visaApplication.findUniqueOrThrow({ where: { id: payment.applicationId }, select: { id: true, applicationNumber: true, packageName: true, packageCountry: true, status: true } }),
    OPEN.includes(payment.status) ? getAvailableMethods(payment.currency) : Promise.resolve([] as AvailableMethod[]),
    payment.method === "BANK_TRANSFER" || OPEN.includes(payment.status)
      ? db.bankAccount.findMany({ where: { isActive: true, currency: payment.currency }, orderBy: { sortOrder: "asc" } })
      : Promise.resolve([]),
  ]);
  return { payment, application, methods, banks, items: payment.lineItems as unknown as LineItem[] };
}

export async function listClientPayments(actor: Actor, opts: { page?: number; pageSize?: number } = {}) {
  requireClient(actor);
  const pageSize = Math.min(opts.pageSize ?? 20, 50);
  const page = Math.max(opts.page ?? 1, 1);
  const where = { clientId: actor.id };
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where, orderBy: { createdAt: "desc" }, take: pageSize, skip: (page - 1) * pageSize,
      select: { id: true, reference: true, description: true, amountMinor: true, currency: true, method: true, status: true, paidAt: true, createdAt: true, application: { select: { id: true, applicationNumber: true, packageName: true } } },
    }),
    db.payment.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** All payments for one of the client's own applications (ownership enforced by clientId). */
export async function listPaymentsForClientApplication(actor: Actor, applicationId: string) {
  requireClient(actor);
  return db.payment.findMany({
    where: { applicationId, clientId: actor.id }, orderBy: { createdAt: "asc" },
    select: { id: true, reference: true, kind: true, description: true, amountMinor: true, currency: true, method: true, status: true, paidAt: true },
  });
}

/** The payment (if any) of the client's own application: used to point "pay now" links. */
export async function getApplicationPaymentId(actor: Actor, applicationId: string): Promise<string | null> {
  requireClient(actor);
  const p = await db.payment.findFirst({ where: { applicationId, clientId: actor.id, kind: "APPLICATION" }, select: { id: true } });
  return p?.id ?? null;
}

// ---------------------------------------------------------------------------
// Starting a payment
// ---------------------------------------------------------------------------

async function loadPayableOrThrow(actor: Actor, paymentId: string) {
  const payment = await getOwnedPayment(actor, paymentId);
  if (!OPEN.includes(payment.status)) {
    throw new AppError(payment.status === "PROCESSING" ? "This payment is already being processed." : "This payment can't be started again.", "CONFLICT");
  }
  if (payment.kind === "APPLICATION") {
    const app = await db.visaApplication.findUniqueOrThrow({ where: { id: payment.applicationId }, select: { status: true } });
    if (app.status !== "PAYMENT_PENDING") throw new AppError("This application isn't awaiting payment.", "CONFLICT");
  }
  return payment;
}

/** Start an online payment: create a gateway checkout for the server-computed amount and return its URL. */
export async function startGatewayPayment(actor: Actor, paymentId: string, method: string): Promise<{ checkoutUrl: string }> {
  const payment = await loadPayableOrThrow(actor, paymentId);
  const gateway = getGateway(method);
  const available = await getAvailableMethods(payment.currency);
  if (!gateway || !available.some((m) => m.method === gateway.method)) throw new AppError("That payment method isn't available right now.", "VALIDATION");
  if (!(await rateLimit(`pay:${actor.id}`, 20, 10 * 60_000)).ok) throw new AppError("Too many payment attempts. Please wait a few minutes.", "VALIDATION");

  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { email: true, name: true, phone: true } });
  const attempt = (await db.paymentTransaction.count({ where: { paymentId: payment.id, event: "initialize" } })) + 1;
  const gatewayReference = `${payment.reference}-${attempt}`;

  let init;
  try {
    init = await gateway.initialize({
      reference: gatewayReference, amountMinor: payment.amountMinor, currency: payment.currency, // amount/currency come from OUR record only
      customer: { email: user.email, name: user.name, phone: user.phone },
      description: payment.description,
      callbackUrl: `${appUrl()}/client/payments/return?payment=${encodeURIComponent(payment.reference)}`,
      webhookUrl: `${appUrl()}/api/webhooks/${gateway.method.toLowerCase()}`,
    });
  } catch (e) {
    console.error(`[payments] ${gateway.method} initialize failed:`, e instanceof Error ? e.message : e);
    throw new AppError(`We couldn't start your ${gateway.label} payment. Please try again or choose another method.`, "VALIDATION");
  }

  await db.$transaction([
    db.paymentTransaction.create({
      data: { paymentId: payment.id, provider: gateway.method, event: "initialize", providerReference: gatewayReference, status: "initialized", amountMinor: payment.amountMinor, currency: payment.currency, payload: init.raw as Prisma.InputJsonValue },
    }),
    db.payment.update({ where: { id: payment.id }, data: { method: gateway.method, status: "PENDING", failureReason: null } }),
  ]);
  await recordAudit({ actorId: actor.id, action: "payment.initiated", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, method: gateway.method, amountMinor: payment.amountMinor, currency: payment.currency } });
  return { checkoutUrl: init.checkoutUrl };
}

/** Choose manual bank transfer for this payment (the client then sends the money and uploads proof). */
export async function chooseBankTransfer(actor: Actor, paymentId: string) {
  const payment = await loadPayableOrThrow(actor, paymentId);
  const available = await getAvailableMethods(payment.currency);
  if (!available.some((m) => m.method === "BANK_TRANSFER")) throw new AppError("Bank transfer isn't available for this payment.", "VALIDATION");
  await db.payment.update({ where: { id: payment.id }, data: { method: "BANK_TRANSFER", status: "PENDING", failureReason: null } });
  await recordAudit({ actorId: actor.id, action: "payment.initiated", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, method: "BANK_TRANSFER" } });
}

// ---------------------------------------------------------------------------
// Confirming a payment (the ONLY ways a payment becomes SUCCESS)
// ---------------------------------------------------------------------------

export type FinalizeOutcome = "success" | "already_paid" | "pending" | "failed" | "mismatch" | "unknown" | "unverified";

async function markPaymentSuccess(paymentId: string, ctx: { method: PaymentMethod; confirmedById?: string | null; reviewNote?: string | null; note?: string }): Promise<"success" | "already_paid"> {
  const result = await db.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: ["PENDING", "PROCESSING", "FAILED", "CANCELLED"] } },
      data: {
        status: "SUCCESS", paidAt: new Date(), method: ctx.method, failureReason: null,
        ...(ctx.confirmedById ? { reviewedById: ctx.confirmedById, reviewedAt: new Date(), reviewNote: ctx.reviewNote ?? null } : {}),
      },
    });
    if (res.count !== 1) return null; // already paid (or refunded): never double-count
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.kind === "APPLICATION") {
      const moved = await tx.visaApplication.updateMany({ where: { id: payment.applicationId, status: "PAYMENT_PENDING" }, data: { status: "PAYMENT_CONFIRMED" } });
      if (moved.count === 1) {
        await tx.applicationStatusHistory.create({
          data: { applicationId: payment.applicationId, fromStatus: "PAYMENT_PENDING", toStatus: "PAYMENT_CONFIRMED", changedById: ctx.confirmedById ?? null, note: `Payment received (reference ${payment.reference})` },
        });
      }
    }
    return payment;
  });

  if (!result) return "already_paid";
  await recordAudit({
    actorId: ctx.confirmedById ?? null, action: "payment.confirmed", entityType: "Payment", entityId: paymentId,
    metadata: { reference: result.reference, method: ctx.method, amountMinor: result.amountMinor, currency: result.currency, note: ctx.note },
  });
  // Email failures must never undo a confirmed payment.
  const [user, app] = await Promise.all([
    db.user.findUnique({ where: { id: result.clientId }, select: { email: true, name: true } }),
    db.visaApplication.findUnique({ where: { id: result.applicationId }, select: { applicationNumber: true, packageName: true } }),
  ]);
  if (user && app) {
    await sendEmailSafely({
      to: user.email,
      ...paymentSuccessEmail({ name: user.name, reference: result.reference, amount: formatMinor(result.amountMinor, result.currency), applicationNumber: app.applicationNumber, packageName: app.packageName, link: `${appUrl()}/client/payments/${result.id}` }),
    });
  }
  return "success";
}

/**
 * Ask the gateway what really happened to an attempt and update our record accordingly.
 * Used by the webhook and by the return page, so both paths are identical and idempotent.
 * Nothing from the browser (query string, status flags) is trusted; the gateway's verify API decides.
 */
export async function finalizeGatewayPayment(provider: GatewayMethod, gatewayReference: string): Promise<{ outcome: FinalizeOutcome; paymentId?: string }> {
  const gateway = getGateway(provider);
  if (!gateway || !gateway.isConfigured()) return { outcome: "unverified" };
  const attempt = await db.paymentTransaction.findFirst({ where: { provider, providerReference: gatewayReference, event: "initialize" }, include: { payment: true } });
  if (!attempt) return { outcome: "unknown" };
  const payment = attempt.payment;

  let result;
  try {
    result = await gateway.verify(gatewayReference);
  } catch (e) {
    console.error(`[payments] ${provider} verify failed:`, e instanceof Error ? e.message : e);
    return { outcome: "unverified", paymentId: payment.id };
  }
  await db.paymentTransaction.create({
    data: { paymentId: payment.id, provider, event: "verify", providerReference: gatewayReference, status: result.status, amountMinor: result.amountMinor, currency: result.currency, payload: result.raw as Prisma.InputJsonValue },
  });

  if (result.status === "success") {
    const matches =
      result.amountMinor === payment.amountMinor && result.currency === payment.currency && (result.reference === null || result.reference === gatewayReference);
    if (!matches) {
      // Paid, but not what we expected: never auto-confirm. Park it for a human.
      await db.payment.updateMany({
        where: { id: payment.id, status: { in: ["PENDING", "FAILED", "CANCELLED"] } },
        data: { status: "PROCESSING", failureReason: `Gateway reported ${result.amountMinor ?? "?"} ${result.currency ?? "?"} but ${payment.amountMinor} ${payment.currency} was expected. Needs staff review.` },
      });
      await recordAudit({ actorId: null, action: "payment.mismatch", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, provider, expected: { amountMinor: payment.amountMinor, currency: payment.currency }, got: { amountMinor: result.amountMinor, currency: result.currency, reference: result.reference } } });
      return { outcome: "mismatch", paymentId: payment.id };
    }
    const done = await markPaymentSuccess(payment.id, { method: provider, note: `gateway reference ${gatewayReference}` });
    if (done === "already_paid") {
      // A second successful charge for something already paid (e.g. paid in two tabs): flag for a refund review.
      const prior = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
      if (prior && PAID.includes(prior.status) && !(await db.paymentTransaction.findFirst({ where: { paymentId: payment.id, providerReference: gatewayReference, event: "duplicate_success" } }))) {
        const earlierSuccess = await db.paymentTransaction.findFirst({ where: { paymentId: payment.id, event: "verify", status: "success", providerReference: { not: gatewayReference } } });
        if (earlierSuccess) {
          await db.paymentTransaction.create({ data: { paymentId: payment.id, provider, event: "duplicate_success", providerReference: gatewayReference, status: "success", amountMinor: result.amountMinor, currency: result.currency, note: "Second successful charge for an already-paid payment: refund needed" } });
          await recordAudit({ actorId: null, action: "payment.duplicate_detected", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, provider, gatewayReference } });
        }
      }
    }
    return { outcome: done === "success" ? "success" : "already_paid", paymentId: payment.id };
  }

  if (result.status === "failed") {
    await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureReason: "The payment was not completed." } });
    return { outcome: "failed", paymentId: payment.id };
  }
  return { outcome: "pending", paymentId: payment.id };
}

/** Handle a webhook call. Returns the HTTP status to answer with. Safe to call repeatedly with the same payload. */
export async function handleGatewayWebhook(provider: GatewayMethod, rawBody: string, headers: Headers): Promise<{ status: number; body: string }> {
  const gateway = getGateway(provider);
  if (!gateway || !gateway.isConfigured()) return { status: 503, body: "not configured" };
  const check = gateway.checkWebhook(rawBody, headers);
  if (!check.valid) return { status: 401, body: "invalid signature" };
  const event = check.event;
  if (!event || event.type === "ignored") return { status: 200, body: "ignored" };

  const outcome = await finalizeGatewayPayment(provider, event.reference); // verified with the gateway; the body is never trusted
  if (outcome.outcome === "unverified") return { status: 502, body: "could not verify" }; // ask the gateway to retry later

  if (outcome.paymentId) {
    try {
      await db.paymentTransaction.create({
        data: { paymentId: outcome.paymentId, provider, event: `webhook:${event.type}`, dedupeKey: event.eventKey, providerReference: event.reference, status: outcome.outcome },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // duplicate delivery: already recorded
    }
  }
  return { status: 200, body: "ok" };
}

/** The customer came back from the gateway: verify with the gateway and report. */
export async function verifyPaymentReturn(actor: Actor, paymentReference: string) {
  requireClient(actor);
  const payment = await db.payment.findFirst({ where: { reference: paymentReference, clientId: actor.id } });
  if (!payment) throw new AppError("We couldn't find that payment.", "NOT_FOUND");
  let outcome: FinalizeOutcome = "pending";
  if (!PAID.includes(payment.status) && payment.method && payment.method !== "BANK_TRANSFER") {
    const last = await db.paymentTransaction.findFirst({ where: { paymentId: payment.id, event: "initialize" }, orderBy: { createdAt: "desc" } });
    if (last?.providerReference) outcome = (await finalizeGatewayPayment(payment.method as GatewayMethod, last.providerReference)).outcome;
  } else if (PAID.includes(payment.status)) {
    outcome = "success";
  }
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { id: true, status: true, reference: true } });
  return { paymentId: fresh.id, status: fresh.status, reference: fresh.reference, outcome };
}

// ---------------------------------------------------------------------------
// Manual bank transfer
// ---------------------------------------------------------------------------

export async function submitTransferProof(
  actor: Actor,
  paymentId: string,
  input: { filename: string; bytes: Buffer; senderName: string; transferDate: string },
) {
  const payment = await getOwnedPayment(actor, paymentId);
  if (payment.method !== "BANK_TRANSFER" || !["PENDING", "FAILED", "PROCESSING"].includes(payment.status)) {
    throw new AppError("Proof of transfer can't be submitted for this payment.", "CONFLICT");
  }
  const senderName = input.senderName.trim();
  if (senderName.length < 2 || senderName.length > 120) throw new AppError("Enter the name on the account you paid from.", "VALIDATION", { senderName: ["Required"] });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.transferDate) ? new Date(`${input.transferDate}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000 || date.getUTCFullYear() < 2020) {
    throw new AppError("Enter the date you made the transfer.", "VALIDATION", { transferDate: ["Enter a valid date"] });
  }
  if (input.bytes.length === 0) throw new AppError("That file is empty. Please choose another file.", "VALIDATION");
  if (input.bytes.length > MAX_SERVER_UPLOAD_BYTES) throw new AppError("That file is too large. The maximum size is 4MB.", "VALIDATION");
  const format = sniffFormat(input.bytes);
  if (!format) throw new AppError("Unsupported file type. Upload a PDF, JPG or PNG of your transfer receipt.", "VALIDATION");

  const key = newPaymentProofKey(payment.id, format);
  const storage = getPrivateStorage();
  await storage.put(key, input.bytes, MIME_BY_FORMAT[format]);
  try {
    await db.$transaction([
      db.payment.update({
        where: { id: payment.id },
        data: {
          status: "PROCESSING", failureReason: null, proofStorageKey: key, proofFilename: safeFilename(input.filename, format), proofMimeType: MIME_BY_FORMAT[format],
          proofSizeBytes: input.bytes.length, senderName, transferDate: date, proofSubmittedAt: new Date(), reviewedById: null, reviewedAt: null, reviewNote: null,
        },
      }),
      db.paymentTransaction.create({ data: { paymentId: payment.id, provider: "BANK_TRANSFER", event: "proof_submitted", providerReference: payment.reference, status: "submitted", note: `Proof stored at ${key}`, amountMinor: payment.amountMinor, currency: payment.currency } }),
    ]);
  } catch (e) {
    await storage.delete(key).catch(() => undefined);
    throw e;
  }
  await recordAudit({ actorId: actor.id, action: "payment.proof_submitted", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference } });
}

/** Authorised read of a transfer proof: the owning client, or staff with payments.view inside their scope. */
export async function openPaymentProof(actor: Actor | null, paymentId: string) {
  if (!actor) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  let payment;
  if (actor.role === "CLIENT") {
    payment = await db.payment.findFirst({ where: { id: paymentId, clientId: actor.id } });
  } else {
    requirePermission(actor, "payments.view");
    payment = await db.payment.findFirst({ where: { id: paymentId, application: applicationScope(actor) } });
    if (payment?.proofStorageKey) await recordAudit({ actorId: actor.id, action: "payment.proof_viewed", entityType: "Payment", entityId: payment.id });
  }
  if (!payment || !payment.proofStorageKey) throw new AppError("We couldn't find that file.", "NOT_FOUND");
  const object = await getPrivateStorage().get(payment.proofStorageKey);
  if (!object) throw new AppError("We couldn't retrieve that file.", "NOT_FOUND");
  return { payment, object };
}

// ---------------------------------------------------------------------------
// Staff: review, additional charges, refunds
// ---------------------------------------------------------------------------

async function getManagedPayment(actor: Actor, paymentId: string, permission: "payments.view" | "payments.manage" | "payments.refund") {
  requirePermission(actor, permission);
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  const payment = await db.payment.findFirst({ where: { id: paymentId, application: applicationScope(actor) } });
  if (!payment) throw new AppError("We couldn't find that payment.", "NOT_FOUND");
  return payment;
}

export async function reviewBankTransfer(actor: Actor, paymentId: string, input: { action: "confirm" | "reject"; note?: string }) {
  const payment = await getManagedPayment(actor, paymentId, "payments.manage");
  if (payment.method !== "BANK_TRANSFER") throw new AppError("Only bank transfers are confirmed by hand. Online payments confirm themselves.", "VALIDATION");
  if (!["PENDING", "PROCESSING"].includes(payment.status)) throw new AppError("This payment has already been dealt with.", "CONFLICT");
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new AppError("The note is too long (maximum 500 characters).", "VALIDATION");

  if (input.action === "confirm") {
    const r = await markPaymentSuccess(payment.id, { method: "BANK_TRANSFER", confirmedById: actor.id, reviewNote: note, note: "bank transfer confirmed by staff" });
    if (r === "already_paid") throw new AppError("This payment was just confirmed by someone else.", "CONFLICT");
    return;
  }
  if (!note || note.length < 3) throw new AppError("Tell the client why the transfer wasn't accepted.", "VALIDATION", { note: ["A reason is required"] });
  const res = await db.payment.updateMany({
    where: { id: payment.id, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "FAILED", failureReason: note, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note },
  });
  if (res.count !== 1) throw new AppError("This payment was just updated by someone else.", "CONFLICT");
  await recordAudit({ actorId: actor.id, action: "payment.transfer_rejected", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, reason: note } });
}

export async function requestAdditionalPayment(actor: Actor, applicationId: string, input: { label: string; amountMinor: number }) {
  requirePermission(actor, "payments.manage");
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  const app = await db.visaApplication.findFirst({ where: { id: applicationId, ...applicationScope(actor) }, select: { id: true, clientId: true, packageId: true, status: true } });
  if (!app) throw new AppError("We couldn't find that application.", "NOT_FOUND");
  if (app.status === "DRAFT" || app.status === "CANCELLED") throw new AppError("You can't request a payment for this application.", "VALIDATION");
  const label = input.label.trim();
  if (label.length < 3 || label.length > 120) throw new AppError("Describe what the payment is for.", "VALIDATION", { label: ["Enter a short description"] });
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > 100_000_000_00) throw new AppError("Enter a valid amount.", "VALIDATION", { amount: ["Enter a valid amount"] });
  const pkg = await db.travelPackage.findUniqueOrThrow({ where: { id: app.packageId }, select: { currency: true } });
  const payment = await db.$transaction((tx) => createPaymentRow(tx, { applicationId: app.id, clientId: app.clientId, kind: "ADDITIONAL", description: label, items: [{ label, amountMinor: input.amountMinor }], currency: pkg.currency, createdById: actor.id }));
  await recordAudit({ actorId: actor.id, action: "payment.created", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, amountMinor: payment.amountMinor, kind: "ADDITIONAL" } });
  return payment;
}

export async function cancelPayment(actor: Actor, paymentId: string, reason?: string) {
  const payment = await getManagedPayment(actor, paymentId, "payments.manage");
  if (payment.kind !== "ADDITIONAL") throw new AppError("Package payments can't be cancelled here.", "VALIDATION");
  const res = await db.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED", failureReason: reason?.trim() || "Cancelled by Vinamaz" } });
  if (res.count !== 1) throw new AppError("Only unpaid payments can be cancelled.", "CONFLICT");
  await recordAudit({ actorId: actor.id, action: "payment.cancelled", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference } });
}

/**
 * Record that money was refunded. This only RECORDS the refund: the actual transfer is made in the
 * gateway dashboard or the bank, which this app does not call.
 */
export async function recordRefund(actor: Actor, paymentId: string, input: { amountMinor: number; reason: string }) {
  const payment = await getManagedPayment(actor, paymentId, "payments.refund");
  if (!["SUCCESS", "PARTIALLY_REFUNDED"].includes(payment.status)) throw new AppError("Only paid payments can be refunded.", "VALIDATION");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new AppError("Record why the refund was made.", "VALIDATION", { reason: ["Required"] });
  const remaining = payment.amountMinor - payment.refundedAmountMinor;
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > remaining) {
    throw new AppError(`Enter an amount between 0.01 and ${formatMinor(remaining, payment.currency)}.`, "VALIDATION", { amount: ["Invalid amount"] });
  }
  const total = payment.refundedAmountMinor + input.amountMinor;
  const res = await db.payment.updateMany({
    where: { id: payment.id, status: payment.status, refundedAmountMinor: payment.refundedAmountMinor }, // compare-and-set against concurrent refunds
    data: { refundedAmountMinor: total, status: total >= payment.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED", refundReason: reason, refundedAt: new Date() },
  });
  if (res.count !== 1) throw new AppError("This payment was just updated. Please refresh and try again.", "CONFLICT");
  await db.paymentTransaction.create({ data: { paymentId: payment.id, provider: payment.method ?? "BANK_TRANSFER", event: "refund_recorded", amountMinor: input.amountMinor, currency: payment.currency, note: reason } });
  await recordAudit({ actorId: actor.id, action: "payment.refunded", entityType: "Payment", entityId: payment.id, metadata: { reference: payment.reference, amountMinor: input.amountMinor, totalRefundedMinor: total, reason } });
}

// ---------------------------------------------------------------------------
// Staff reads
// ---------------------------------------------------------------------------

export interface PaymentFilters { q?: string; status?: PaymentStatus; method?: PaymentMethod; from?: string; to?: string; page?: number }

export async function listAdminPayments(actor: Actor, f: PaymentFilters = {}) {
  requirePermission(actor, "payments.view");
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  const and: Prisma.PaymentWhereInput[] = [{ application: applicationScope(actor) }];
  const q = f.q?.trim();
  if (q) and.push({ OR: [{ reference: { contains: q, mode: "insensitive" } }, { application: { applicationNumber: { contains: q, mode: "insensitive" } } }, { client: { name: { contains: q, mode: "insensitive" } } }, { client: { email: { contains: q, mode: "insensitive" } } }] });
  if (f.status) and.push({ status: f.status });
  if (f.method) and.push({ method: f.method });
  const created: Prisma.DateTimeFilter = {};
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) created.gte = new Date(`${f.from}T00:00:00.000Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) created.lte = new Date(`${f.to}T23:59:59.999Z`);
  if (created.gte || created.lte) and.push({ createdAt: created });
  const where = { AND: and };
  const pageSize = 20;
  const page = Math.max(f.page ?? 1, 1);
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where, orderBy: { createdAt: "desc" }, take: pageSize, skip: (page - 1) * pageSize,
      select: { id: true, reference: true, kind: true, amountMinor: true, currency: true, method: true, status: true, paidAt: true, createdAt: true, client: { select: { name: true, email: true } }, application: { select: { id: true, applicationNumber: true, packageName: true } } },
    }),
    db.payment.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getAdminPaymentView(actor: Actor, paymentId: string) {
  const payment = await getManagedPayment(actor, paymentId, "payments.view");
  const [transactions, application, client] = await Promise.all([
    db.paymentTransaction.findMany({ where: { paymentId: payment.id }, orderBy: { createdAt: "desc" } }),
    db.visaApplication.findUniqueOrThrow({ where: { id: payment.applicationId }, select: { id: true, applicationNumber: true, packageName: true, status: true } }),
    db.user.findUniqueOrThrow({ where: { id: payment.clientId }, select: { name: true, email: true, phone: true } }),
  ]);
  const reviewer = payment.reviewedById ? await db.user.findUnique({ where: { id: payment.reviewedById }, select: { name: true } }) : null;
  return { payment, transactions, application, client, reviewerName: reviewer?.name ?? null, items: payment.lineItems as unknown as LineItem[] };
}

export async function listApplicationPayments(actor: Actor, applicationId: string) {
  requirePermission(actor, "payments.view");
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  return db.payment.findMany({
    where: { applicationId, application: applicationScope(actor) }, orderBy: { createdAt: "asc" },
    select: { id: true, reference: true, kind: true, description: true, amountMinor: true, currency: true, method: true, status: true, paidAt: true, createdAt: true },
  });
}

/** Receipt data for a paid payment: the owning client or staff with payments.view (in scope). */
export async function getReceipt(actor: Actor | null, paymentId: string) {
  if (!actor) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  let payment;
  if (actor.role === "CLIENT") payment = await db.payment.findFirst({ where: { id: paymentId, clientId: actor.id } });
  else {
    requirePermission(actor, "payments.view");
    payment = await db.payment.findFirst({ where: { id: paymentId, application: applicationScope(actor) } });
  }
  if (!payment) throw new AppError("We couldn't find that payment.", "NOT_FOUND");
  if (!PAID.includes(payment.status) || !payment.paidAt) throw new AppError("A receipt is only available once the payment has been confirmed.", "VALIDATION");
  const [client, application] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: payment.clientId }, select: { name: true, email: true } }),
    db.visaApplication.findUniqueOrThrow({ where: { id: payment.applicationId }, select: { applicationNumber: true, packageName: true, packageCountry: true } }),
  ]);
  return { payment, client, application, items: payment.lineItems as unknown as LineItem[] };
}
