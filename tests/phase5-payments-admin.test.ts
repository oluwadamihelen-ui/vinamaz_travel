import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setEmailProviderForTests, type EmailMessage } from "@/lib/email/provider";
import { setFetchForTests } from "@/lib/payments/http";
import { getAdminDashboard } from "@/lib/services/admin-dashboard";
import { listAuditLog } from "@/lib/services/audit";
import { getApplicationView, saveApplicationStep, startApplication } from "@/lib/services/applications";
import { getAvailableMethods, finalizeGatewayPayment, recheckPayment, refundPayment, resolveHeldPayment, startGatewayPayment } from "@/lib/services/payments";
import { setMethodCurrencies } from "@/lib/services/payment-settings";
import { updatePackage } from "@/lib/services/packages";
import { PRICED_TOTAL_MINOR, STAFF_PERMS, makeActivePackage, validPackage, makePricedPackage, makeUser, resetDb, submittedApplication } from "./helpers";

let sent: EmailMessage[] = [];
let calls: { url: string; body: unknown }[] = [];
let verify: { status: string; amount?: number; currency?: string } = { status: "success" };
let refundReply: () => Response = () => json({ status: true, data: { id: 77, status: "pending" } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  await resetDb();
  sent = [];
  calls = [];
  verify = { status: "success" };
  refundReply = () => json({ status: true, data: { id: 77, status: "pending" } });
  setEmailProviderForTests({ send: async (m) => { sent.push(m); } });
  setFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: u, body });
    if (u.includes("/transaction/initialize")) return json({ status: true, data: { authorization_url: "https://checkout.paystack.com/x", reference: body.reference } });
    const m = /\/transaction\/verify\/(.+)$/.exec(u);
    if (m) return json({ status: true, data: { status: verify.status, reference: decodeURIComponent(m[1]!), amount: verify.amount ?? PRICED_TOTAL_MINOR, currency: verify.currency ?? "NGN", id: 4242 } });
    if (u.endsWith("/refund")) return refundReply();
    return json({}, 404);
  }) as unknown as typeof fetch);
});
afterEach(() => setFetchForTests(undefined));

async function paidWorld(opts: { verifyResult?: typeof verify } = {}) {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const root = await makeUser("SUPER_ADMIN", "root@x.com");
  const pkg = await makePricedPackage(admin);
  const client = await makeUser("CLIENT", "c@x.com");
  const app = await submittedApplication(client, pkg.slug);
  const payment = await db.payment.findFirstOrThrow({ where: { applicationId: app } });
  await startGatewayPayment(client, payment.id, "PAYSTACK");
  if (opts.verifyResult) verify = opts.verifyResult;
  const outcome = await finalizeGatewayPayment("PAYSTACK", `${payment.reference}-1`);
  return { admin, root, pkg, client, app, payment, outcome };
}
const reload = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });

describe("gateway refunds", () => {
  it("refunds through Paystack for the verified charge and records it", async () => {
    const w = await paidWorld();
    const r = await refundPayment(w.root, w.payment.id, { amountMinor: 5_000_000, reason: "Service not rendered" });
    expect(r).toEqual({ via: "gateway", gatewayStatus: "pending" });
    const call = calls.find((c) => c.url.endsWith("/refund"))!;
    expect(call.body).toMatchObject({ transaction: `${w.payment.reference}-1`, amount: 5_000_000, currency: "NGN" });
    expect(await reload(w.payment.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmountMinor: 5_000_000 });
    expect(await db.paymentTransaction.count({ where: { paymentId: w.payment.id, event: "refund_requested" } })).toBe(1);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "payment.refunded" } })).metadata).toMatchObject({ via: "gateway" });
  });
  it("a gateway rejection changes nothing (the reserved amount is released) and says so", async () => {
    const w = await paidWorld();
    refundReply = () => json({ status: false, message: "Insufficient balance" }, 400);
    await expect(refundPayment(w.root, w.payment.id, { amountMinor: 1_000_000, reason: "Customer request" })).rejects.toThrow(/did not accept the refund/);
    expect(await reload(w.payment.id)).toMatchObject({ status: "SUCCESS", refundedAmountMinor: 0 });
    expect(await db.paymentTransaction.count({ where: { paymentId: w.payment.id, event: "refund_failed" } })).toBe(1);
    // and it can be retried afterwards
    refundReply = () => json({ status: true, data: { id: 78, status: "processed" } });
    await expect(refundPayment(w.root, w.payment.id, { amountMinor: PRICED_TOTAL_MINOR, reason: "Customer request" })).resolves.toMatchObject({ gatewayStatus: "processed" });
    expect((await reload(w.payment.id)).status).toBe("REFUNDED");
  });
  it("concurrent refunds can't exceed the amount paid, and the gateway is only asked for those that were reserved", async () => {
    const w = await paidWorld();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => refundPayment(w.root, w.payment.id, { amountMinor: 9_000_000, reason: "Race" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/refund"))).toHaveLength(1);
    expect((await reload(w.payment.id)).refundedAmountMinor).toBe(9_000_000);
  });
  it("needs payments.refund; validates amount and reason", async () => {
    const w = await paidWorld();
    await expect(refundPayment(w.admin, w.payment.id, { amountMinor: 100, reason: "No permission" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(refundPayment(w.client, w.payment.id, { amountMinor: 100, reason: "Client" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(refundPayment(w.root, w.payment.id, { amountMinor: PRICED_TOTAL_MINOR + 1, reason: "Too much" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(refundPayment(w.root, w.payment.id, { amountMinor: 100, reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls.some((c) => c.url.endsWith("/refund"))).toBe(false);
  });
  it("gateways without a refund API (and bank transfers) fall back to recording the refund", async () => {
    const w = await paidWorld();
    await db.payment.update({ where: { id: w.payment.id }, data: { method: "KORAPAY" } }); // Korapay adapter has no refund call
    const r = await refundPayment(w.root, w.payment.id, { amountMinor: 1_000_000, reason: "Recorded manually" });
    expect(r).toEqual({ via: "recorded" });
    expect(calls.some((c) => c.url.endsWith("/refund"))).toBe(false);
    expect((await reload(w.payment.id)).refundedAmountMinor).toBe(1_000_000);
  });
});

describe("payments held for a person's decision", () => {
  it("a mismatching charge is parked; staff can accept it (paid, application advances) or reject it (client told)", async () => {
    const accept = await paidWorld({ verifyResult: { status: "success", amount: 100 } });
    expect(accept.outcome.outcome).toBe("mismatch");
    expect(await reload(accept.payment.id)).toMatchObject({ status: "PROCESSING" });
    expect(await db.notification.count({ where: { userId: accept.admin.id, type: "payment.review_needed" } })).toBe(1);
    await expect(resolveHeldPayment(accept.admin, accept.payment.id, { action: "approve", note: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resolveHeldPayment(accept.client, accept.payment.id, { action: "approve", note: "nope nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await resolveHeldPayment(accept.admin, accept.payment.id, { action: "approve", note: "Customer paid the discounted rate by agreement" });
    expect(await reload(accept.payment.id)).toMatchObject({ status: "SUCCESS", reviewNote: "Customer paid the discounted rate by agreement" });
    expect((await db.visaApplication.findUniqueOrThrow({ where: { id: accept.app } })).status).toBe("PAYMENT_CONFIRMED");
    await expect(resolveHeldPayment(accept.admin, accept.payment.id, { action: "approve", note: "again again" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "payment.held_approved" } })).metadata).toMatchObject({ chargedAmountMinor: 100 });
  });
  it("rejecting a held payment marks it failed, flags a refund, and emails the client", async () => {
    const w = await paidWorld({ verifyResult: { status: "success", currency: "USD" } });
    sent = [];
    await resolveHeldPayment(w.admin, w.payment.id, { action: "reject", note: "Wrong currency charged" });
    expect(await reload(w.payment.id)).toMatchObject({ status: "FAILED" });
    expect(sent.some((m) => /Payment unsuccessful/.test(m.subject))).toBe(true);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "payment.held_rejected" } })).metadata).toMatchObject({ refundNeeded: true });
  });
  it("re-checking asks the gateway again and settles the payment when it now matches", async () => {
    const w = await paidWorld({ verifyResult: { status: "success", amount: 100 } });
    verify = { status: "success" };
    await expect(recheckPayment(w.client, w.payment.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await recheckPayment(w.admin, w.payment.id)).toBe("success");
    expect((await reload(w.payment.id)).status).toBe("SUCCESS");
    await expect(recheckPayment(w.admin, w.payment.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("gateway currencies are configurable", () => {
  it("an administrator's list replaces the defaults; clearing it restores them", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const admin = await makeUser("ADMIN", "admin@x.com");
    expect((await getAvailableMethods("EUR")).map((m) => m.method)).toEqual(["FLUTTERWAVE"]);
    await setMethodCurrencies(root, "PAYSTACK", "eur, usd, ngn");
    expect((await getAvailableMethods("EUR")).map((m) => m.method)).toEqual(["PAYSTACK", "FLUTTERWAVE"]);
    await setMethodCurrencies(root, "PAYSTACK", "ghs");
    expect((await getAvailableMethods("NGN")).map((m) => m.method)).not.toContain("PAYSTACK");
    await setMethodCurrencies(root, "PAYSTACK", "");
    expect((await getAvailableMethods("NGN")).map((m) => m.method)).toContain("PAYSTACK");
    await expect(setMethodCurrencies(admin, "PAYSTACK", "ngn")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setMethodCurrencies(root, "PAYSTACK", "naira")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setMethodCurrencies(root, "BANK_TRANSFER", "ngn")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("package configuration snapshot", () => {
  it("editing a package after an application started doesn't change that application's questions or documents", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const pkg = await makeActivePackage(admin);
    const client = await makeUser("CLIENT", "c@x.com");
    const { id } = await startApplication(client, pkg.slug);
    const before = await getApplicationView(client, id);
    const questionKeys = before.config.questions.map((q) => q.key);
    // staff rewrite the package: drop every question and document requirement
    await updatePackage(admin, pkg.id, validPackage({ name: "Canada Visa Assistance", slug: pkg.slug, status: "ACTIVE", questions: [], documentRequirements: [] }));
    expect(await db.packageQuestion.count({ where: { packageId: pkg.id } })).toBe(0);
    const after = await getApplicationView(client, id);
    expect(after.config.questions.map((q) => q.key)).toEqual(questionKeys);
    expect(after.slots.map((s) => s.name)).toEqual(before.slots.map((s) => s.name));
    // and the client can still save an answer to a question that has since been removed from the package
    await expect(saveApplicationStep(client, id, "s-passport", { passport_number: "A1234567" }, { advance: false })).resolves.toBeTruthy();
    // a NEW application picks up the current (now empty) configuration
    const other = await makeUser("CLIENT", "d@x.com");
    const second = await startApplication(other, pkg.slug);
    expect((await getApplicationView(other, second.id)).config.questions).toHaveLength(0);
  });
});

describe("audit log and dashboard", () => {
  it("only audit.view holders can read the audit log; filters and pagination work", async () => {
    const w = await paidWorld();
    const { root, admin } = w;
    await expect(listAuditLog(admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAuditLog(w.client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const all = await listAuditLog(root);
    expect(all.total).toBeGreaterThan(3);
    expect(all.actions).toEqual(expect.arrayContaining(["application.submitted", "payment.created", "payment.confirmed"]));
    expect((await listAuditLog(root, { action: "payment.confirmed" })).rows.every((r) => r.action === "payment.confirmed")).toBe(true);
    expect((await listAuditLog(root, { q: w.payment.id })).rows.length).toBeGreaterThan(0);
    expect((await listAuditLog(root, { from: "2999-01-01" })).total).toBe(0);
    expect((await listAuditLog(root, { page: 999 })).rows).toHaveLength(0);
  });
  it("the dashboard shows real totals, hides sections the viewer can't use, and scopes staff to their own applications", async () => {
    const w = await paidWorld();
    const staff = await makeUser("STAFF", "s@x.com", ["applications.view", "documents.view", "documents.review"]);
    const idle = await makeUser("STAFF", "idle@x.com", []);
    const dash = await getAdminDashboard(w.root);
    expect(dash.apps).toMatchObject({ total: 1, inReview: 1 });
    expect(dash.payments).toEqual([{ currency: "NGN", payments: 1, netMinor: PRICED_TOTAL_MINOR, thisMonthMinor: PRICED_TOTAL_MINOR }]);
    expect(dash.recentApps).toHaveLength(1);
    expect(dash.packages[0]).toMatchObject({ name: "Priced Visa Package", submitted: 1 });
    expect(dash.action.find((a) => a.key === "documents")?.count).toBe(1);
    // staff with no assignments sees zero; payments are hidden without payments.view
    const s = await getAdminDashboard(staff);
    expect(s.apps).toMatchObject({ total: 0 });
    expect(s.payments).toBeNull();
    expect(s.clients).toBeNull();
    await db.visaApplication.update({ where: { id: w.app }, data: { assignedToId: staff.id } });
    expect((await getAdminDashboard(staff)).apps).toMatchObject({ total: 1 });
    const none = await getAdminDashboard(idle);
    expect(none.apps).toBeNull();
    expect(none.recentApps).toEqual([]);
    expect(none.action).toEqual([]);
    await expect(getAdminDashboard(w.client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // a refund is netted out of revenue
    await refundPayment(w.root, w.payment.id, { amountMinor: 5_000_000, reason: "Partial" });
    expect((await getAdminDashboard(w.root)).payments![0]!.netMinor).toBe(PRICED_TOTAL_MINOR - 5_000_000);
    void STAFF_PERMS;
  });
});
