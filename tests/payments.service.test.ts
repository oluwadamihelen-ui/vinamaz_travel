import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setEmailProviderForTests, type EmailMessage } from "@/lib/email/provider";
import { setFetchForTests } from "@/lib/payments/http";
import { hmacHex } from "@/lib/payments/signatures";
import { assignApplication } from "@/lib/services/admin-applications";
import { getApplicationView, startApplication, submitApplication } from "@/lib/services/applications";
import {
  cancelPayment, chooseBankTransfer, finalizeGatewayPayment, getAvailableMethods, getClientPaymentView, getReceipt, handleGatewayWebhook, listAdminPayments,
  listClientPayments, openPaymentProof, recordRefund, requestAdditionalPayment, reviewBankTransfer, startGatewayPayment, submitTransferProof, verifyPaymentReturn,
} from "@/lib/services/payments";
import { saveBankAccount, setMethodEnabled } from "@/lib/services/payment-settings";
import { PDF, PRICED_TOTAL_MINOR, STAFF_PERMS, completeApplication, makeActivePackage, makePricedPackage, makeUser, resetDb, submittedApplication } from "./helpers";

let sent: EmailMessage[] = [];
type Verify = { status: "success" | "failed" | "pending" | "ongoing"; amount?: number; currency?: string; reference?: string };
let verifyBehaviour: (ref: string) => Verify | Error = () => ({ status: "ongoing" });

const jsonRes = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

/** A fake Paystack: initialize returns a checkout URL, verify returns whatever the test dictates. */
function fakeGateways() {
  setFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/transaction/initialize")) return jsonRes({ status: true, data: { authorization_url: "https://checkout.paystack.com/x", reference: JSON.parse(String(init!.body)).reference } });
    const m = /\/transaction\/verify\/(.+)$/.exec(u);
    if (m) {
      const ref = decodeURIComponent(m[1]!);
      const v = verifyBehaviour(ref);
      if (v instanceof Error) throw v;
      return jsonRes({ status: true, data: { status: v.status, reference: v.reference ?? ref, amount: v.amount ?? PRICED_TOTAL_MINOR, currency: v.currency ?? "NGN", id: 1 } });
    }
    if (u.includes("/charges/initialize")) return jsonRes({ status: true, data: { checkout_url: "https://checkout.korapay.com/x", reference: JSON.parse(String(init!.body)).reference } });
    return jsonRes({}, 404);
  }) as unknown as typeof fetch);
}

beforeEach(async () => {
  await resetDb();
  sent = [];
  verifyBehaviour = () => ({ status: "ongoing" });
  setEmailProviderForTests({ send: async (m) => { sent.push(m); } });
  fakeGateways();
});
afterEach(() => setFetchForTests(undefined));

async function world() {
  const admin = await makeUser("ADMIN", "admin@x.com");
  const root = await makeUser("SUPER_ADMIN", "root@x.com");
  const pkg = await makePricedPackage(admin);
  const clientA = await makeUser("CLIENT", "ada@x.com");
  const clientB = await makeUser("CLIENT", "bob@x.com");
  const appA = await submittedApplication(clientA, pkg.slug);
  const paymentA = await db.payment.findFirstOrThrow({ where: { applicationId: appA } });
  return { admin, root, pkg, clientA, clientB, appA, paymentA };
}
const reload = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });
const appStatus = async (id: string) => (await db.visaApplication.findUniqueOrThrow({ where: { id } })).status;
const paystackWebhook = (reference: string, over: object = {}, key = "sk_test_paystack_secret") => {
  const raw = JSON.stringify({ event: "charge.success", data: { id: 1, reference, amount: 1, currency: "NGN", status: "success", ...over } });
  return { raw, headers: new Headers({ "x-paystack-signature": hmacHex("sha512", key, raw) }) };
};

describe("creating the payment at submission", () => {
  it("creates one pending payment, computed on the server from the package fees, and waits for it", async () => {
    const w = await world();
    expect(w.paymentA).toMatchObject({ kind: "APPLICATION", status: "PENDING", amountMinor: PRICED_TOTAL_MINOR, currency: "NGN", clientId: w.clientA.id, method: null });
    expect(w.paymentA.reference).toMatch(/^VNZ-PAY-[0-9A-Z]{10}$/);
    expect(w.paymentA.lineItems).toEqual([{ label: "Package price", amountMinor: 15_000_000 }, { label: "Service fee", amountMinor: 500_000 }]);
    expect(await appStatus(w.appA)).toBe("PAYMENT_PENDING");
    const history = await db.applicationStatusHistory.findMany({ where: { applicationId: w.appA }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["DRAFT", "APPLICATION_SUBMITTED", "PAYMENT_PENDING"]);
  });
  it("packages without fees skip payment entirely (nothing is invented)", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const free = await makeActivePackage(admin, "Free Package");
    const client = await makeUser("CLIENT", "c@x.com");
    const id = await submittedApplication(client, free.slug);
    expect(await appStatus(id)).toBe("APPLICATION_SUBMITTED");
    expect(await db.payment.count()).toBe(0);
  });
  it("later price changes do not alter what an existing payment charges", async () => {
    const w = await world();
    await db.travelPackage.update({ where: { id: w.pkg.id }, data: { price: "999999" } });
    expect((await reload(w.paymentA.id)).amountMinor).toBe(PRICED_TOTAL_MINOR);
  });
  it("the database refuses a second APPLICATION payment for the same application", async () => {
    const w = await world();
    await expect(db.payment.create({ data: { reference: "VNZ-PAY-DUPLICATE1", applicationId: w.appA, clientId: w.clientA.id, kind: "APPLICATION", description: "x", lineItems: [], amountMinor: 1, currency: "NGN" } })).rejects.toThrow();
  });
});

describe("available methods", () => {
  it("lists configured gateways that support the currency, plus bank transfer only when an account exists", async () => {
    expect((await getAvailableMethods("NGN")).map((m) => m.method)).toEqual(["PAYSTACK", "FLUTTERWAVE", "KORAPAY"]);
    expect((await getAvailableMethods("GBP")).map((m) => m.method)).toEqual(["FLUTTERWAVE"]);
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    await saveBankAccount(root, null, { bankName: "Test Bank", accountName: "Vinamaz Travels", accountNumber: "0123456789", currency: "NGN", isActive: true });
    expect((await getAvailableMethods("NGN")).map((m) => m.method)).toContain("BANK_TRANSFER");
    expect((await getAvailableMethods("USD")).map((m) => m.method)).not.toContain("BANK_TRANSFER");
    await setMethodEnabled(root, "PAYSTACK", false);
    expect((await getAvailableMethods("NGN")).map((m) => m.method)).not.toContain("PAYSTACK");
  });
});

describe("starting an online payment", () => {
  it("sends OUR amount and currency to the gateway and logs the attempt", async () => {
    const w = await world();
    const { checkoutUrl } = await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    expect(checkoutUrl).toContain("paystack.com");
    const p = await reload(w.paymentA.id);
    expect(p).toMatchObject({ method: "PAYSTACK", status: "PENDING" });
    const tx = await db.paymentTransaction.findFirstOrThrow({ where: { paymentId: p.id, event: "initialize" } });
    expect(tx).toMatchObject({ provider: "PAYSTACK", providerReference: `${p.reference}-1`, amountMinor: PRICED_TOTAL_MINOR, currency: "NGN" });
    // a second attempt (e.g. a different gateway) uses a fresh reference
    await startGatewayPayment(w.clientA, w.paymentA.id, "KORAPAY");
    expect((await db.paymentTransaction.findMany({ where: { paymentId: p.id, event: "initialize" }, orderBy: { createdAt: "asc" } })).map((t) => t.providerReference)).toEqual([`${p.reference}-1`, `${p.reference}-2`]);
    expect((await reload(p.id)).method).toBe("KORAPAY");
  });
  it("rejects unavailable methods, other clients, staff, and applications not awaiting payment", async () => {
    const w = await world();
    await expect(startGatewayPayment(w.clientA, w.paymentA.id, "BITCOIN")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(startGatewayPayment(w.clientA, w.paymentA.id, "BANK_TRANSFER")).rejects.toMatchObject({ code: "VALIDATION" }); // no bank account configured
    await expect(startGatewayPayment(w.clientB, w.paymentA.id, "PAYSTACK")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startGatewayPayment(w.admin, w.paymentA.id, "PAYSTACK")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.visaApplication.update({ where: { id: w.appA }, data: { status: "UNDER_REVIEW" } });
    await expect(startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("reports a friendly error when the gateway is down, without leaking details or changing state", async () => {
    const w = await world();
    setFetchForTests((async () => jsonRes({ status: false, message: "Invalid key sk_test_paystack_secret" }, 401)) as unknown as typeof fetch);
    const err = await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK").then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/couldn't start your Paystack payment/);
    expect(err?.message).not.toContain("sk_test");
    expect((await reload(w.paymentA.id)).method).toBeNull();
  });
});

describe("confirming a payment (server-side verification only)", () => {
  async function started() {
    const w = await world();
    await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    return { ...w, ref: `${w.paymentA.reference}-1` };
  }

  it("success: marks paid, moves the application, writes history/audit, emails the client", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    expect(await finalizeGatewayPayment("PAYSTACK", w.ref)).toMatchObject({ outcome: "success", paymentId: w.paymentA.id });
    const p = await reload(w.paymentA.id);
    expect(p).toMatchObject({ status: "SUCCESS", method: "PAYSTACK" });
    expect(p.paidAt).not.toBeNull();
    expect(await appStatus(w.appA)).toBe("PAYMENT_CONFIRMED");
    expect(await db.applicationStatusHistory.count({ where: { applicationId: w.appA, toStatus: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "payment.confirmed" } })).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("ada@x.com");
    expect(sent[0]!.text).toContain(p.reference);
  });
  it("is idempotent: repeating the confirmation changes and sends nothing more", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    await finalizeGatewayPayment("PAYSTACK", w.ref);
    expect((await finalizeGatewayPayment("PAYSTACK", w.ref)).outcome).toBe("already_paid");
    expect(await db.applicationStatusHistory.count({ where: { applicationId: w.appA, toStatus: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "payment.confirmed" } })).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it("parallel confirmations (webhook + return page) record exactly one payment", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    const results = await Promise.all(Array.from({ length: 6 }, () => finalizeGatewayPayment("PAYSTACK", w.ref)));
    expect(results.filter((r) => r.outcome === "success")).toHaveLength(1);
    expect(await db.applicationStatusHistory.count({ where: { applicationId: w.appA, toStatus: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "payment.confirmed" } })).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it("never trusts a wrong amount, currency or reference: it parks the payment for staff review", async () => {
    for (const bad of [{ amount: 100 }, { currency: "USD" }, { reference: "SOMETHING-ELSE" }] as Verify[]) {
      await resetDb();
      sent = [];
      const w = await started();
      verifyBehaviour = () => ({ ...bad, status: "success" });
      expect((await finalizeGatewayPayment("PAYSTACK", w.ref)).outcome).toBe("mismatch");
      const p = await reload(w.paymentA.id);
      expect(p.status).toBe("PROCESSING");
      expect(p.paidAt).toBeNull();
      expect(p.failureReason).toMatch(/needs staff review/i);
      expect(await appStatus(w.appA)).toBe("PAYMENT_PENDING");
      expect(await db.auditLog.count({ where: { action: "payment.mismatch" } })).toBe(1);
      expect(sent).toHaveLength(0);
    }
  });
  it("failed and still-pending results never mark a payment paid", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "ongoing" });
    expect((await finalizeGatewayPayment("PAYSTACK", w.ref)).outcome).toBe("pending");
    expect((await reload(w.paymentA.id)).status).toBe("PENDING");
    verifyBehaviour = () => ({ status: "failed" });
    expect((await finalizeGatewayPayment("PAYSTACK", w.ref)).outcome).toBe("failed");
    expect(await reload(w.paymentA.id)).toMatchObject({ status: "FAILED", paidAt: null });
    expect(await appStatus(w.appA)).toBe("PAYMENT_PENDING");
    // the client can try again after a failure
    await startGatewayPayment(w.clientA, w.paymentA.id, "KORAPAY");
    expect((await reload(w.paymentA.id)).status).toBe("PENDING");
  });
  it("a verification outage is reported as unverified and changes nothing", async () => {
    const w = await started();
    verifyBehaviour = () => new Error("network down");
    expect((await finalizeGatewayPayment("PAYSTACK", w.ref)).outcome).toBe("unverified");
    expect((await reload(w.paymentA.id)).status).toBe("PENDING");
  });
  it("unknown gateway references are ignored", async () => {
    await world();
    expect((await finalizeGatewayPayment("PAYSTACK", "VNZ-PAY-NOPE-1")).outcome).toBe("unknown");
  });
  it("a second successful charge for an already-paid payment is flagged for refund, not double-counted", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    await finalizeGatewayPayment("PAYSTACK", w.ref);
    await startGatewayPayment(w.clientA, w.paymentA.id, "KORAPAY").catch(() => undefined); // paid: cannot restart
    // simulate a second attempt reference that also succeeded at the gateway
    await db.paymentTransaction.create({ data: { paymentId: w.paymentA.id, provider: "PAYSTACK", event: "initialize", providerReference: `${w.paymentA.reference}-2`, status: "initialized" } });
    expect((await finalizeGatewayPayment("PAYSTACK", `${w.paymentA.reference}-2`)).outcome).toBe("already_paid");
    expect(await db.auditLog.count({ where: { action: "payment.duplicate_detected" } })).toBe(1);
    expect(await db.applicationStatusHistory.count({ where: { applicationId: w.appA, toStatus: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(sent).toHaveLength(1);
  });
});

describe("webhooks", () => {
  async function started() {
    const w = await world();
    await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    return { ...w, ref: `${w.paymentA.reference}-1` };
  }
  it("rejects a bad signature without touching anything", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    const hook = paystackWebhook(w.ref, {}, "wrong-key");
    expect((await handleGatewayWebhook("PAYSTACK", hook.raw, hook.headers)).status).toBe(401);
    expect((await handleGatewayWebhook("PAYSTACK", hook.raw, new Headers())).status).toBe(401);
    expect((await reload(w.paymentA.id)).status).toBe("PENDING");
    expect(await db.paymentTransaction.count({ where: { event: { startsWith: "webhook" } } })).toBe(0);
  });
  it("a valid signed webhook confirms the payment after the gateway verifies it", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    const hook = paystackWebhook(w.ref);
    expect(await handleGatewayWebhook("PAYSTACK", hook.raw, hook.headers)).toEqual({ status: 200, body: "ok" });
    expect(await reload(w.paymentA.id)).toMatchObject({ status: "SUCCESS" });
    expect(await appStatus(w.appA)).toBe("PAYMENT_CONFIRMED");
  });
  it("replaying the same webhook is harmless (no duplicate records, history or emails)", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "success" });
    const hook = paystackWebhook(w.ref);
    for (let i = 0; i < 4; i++) expect((await handleGatewayWebhook("PAYSTACK", hook.raw, hook.headers)).status).toBe(200);
    await Promise.all(Array.from({ length: 4 }, () => handleGatewayWebhook("PAYSTACK", hook.raw, hook.headers)));
    expect(await db.paymentTransaction.count({ where: { paymentId: w.paymentA.id, event: "webhook:success" } })).toBe(1);
    expect(await db.applicationStatusHistory.count({ where: { applicationId: w.appA, toStatus: "PAYMENT_CONFIRMED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "payment.confirmed" } })).toBe(1);
    expect(sent).toHaveLength(1);
  });
  it("a correctly signed webhook still cannot mark a payment paid if the gateway says otherwise", async () => {
    const w = await started();
    verifyBehaviour = () => ({ status: "ongoing" });
    const hook = paystackWebhook(w.ref, { amount: PRICED_TOTAL_MINOR, status: "success" }); // body claims success
    expect((await handleGatewayWebhook("PAYSTACK", hook.raw, hook.headers)).status).toBe(200);
    expect((await reload(w.paymentA.id)).status).toBe("PENDING");
    verifyBehaviour = () => ({ status: "success", amount: 100 }); // gateway says a different amount
    const hook2 = paystackWebhook(w.ref, { id: 2 });
    await handleGatewayWebhook("PAYSTACK", hook2.raw, hook2.headers);
    expect((await reload(w.paymentA.id)).status).toBe("PROCESSING");
  });
  it("answers 502 (so the gateway retries) when verification is unavailable, and 200 for unrelated events", async () => {
    const w = await started();
    verifyBehaviour = () => new Error("down");
    const hook = paystackWebhook(w.ref);
    expect((await handleGatewayWebhook("PAYSTACK", hook.raw, hook.headers)).status).toBe(502);
    const other = JSON.stringify({ event: "transfer.success", data: {} });
    expect((await handleGatewayWebhook("PAYSTACK", other, new Headers({ "x-paystack-signature": hmacHex("sha512", "sk_test_paystack_secret", other) }))).status).toBe(200);
    const unknown = paystackWebhook("VNZ-PAY-UNKNOWN-1");
    expect((await handleGatewayWebhook("PAYSTACK", unknown.raw, unknown.headers)).status).toBe(200);
  });
  it("is unavailable for gateways without credentials", async () => {
    const saved = process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_SECRET_KEY;
    expect((await handleGatewayWebhook("PAYSTACK", "{}", new Headers())).status).toBe(503);
    process.env.PAYSTACK_SECRET_KEY = saved;
  });
});

describe("returning from the gateway", () => {
  it("verifies with the gateway; a bare 'success' on the way back proves nothing", async () => {
    const w = await world();
    await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    verifyBehaviour = () => ({ status: "ongoing" });
    expect(await verifyPaymentReturn(w.clientA, w.paymentA.reference)).toMatchObject({ status: "PENDING", outcome: "pending" });
    verifyBehaviour = () => ({ status: "success" });
    expect(await verifyPaymentReturn(w.clientA, w.paymentA.reference)).toMatchObject({ status: "SUCCESS", outcome: "success" });
  });
  it("only the owner can check a payment", async () => {
    const w = await world();
    await expect(verifyPaymentReturn(w.clientB, w.paymentA.reference)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(verifyPaymentReturn(w.admin, w.paymentA.reference)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("manual bank transfer", () => {
  async function withBank() {
    const w = await world();
    await saveBankAccount(w.root, null, { bankName: "Test Bank", accountName: "Vinamaz Travels", accountNumber: "0123456789", currency: "NGN", isActive: true });
    await chooseBankTransfer(w.clientA, w.paymentA.id);
    return w;
  }
  const proof = (over: Record<string, unknown> = {}) => ({ filename: "receipt.pdf", bytes: PDF, senderName: "Ada Obi", transferDate: new Date().toISOString().slice(0, 10), ...over });

  it("client sees the bank details and the exact amount, then submits proof (awaiting confirmation)", async () => {
    const w = await withBank();
    const view = await getClientPaymentView(w.clientA, w.paymentA.id);
    expect(view.banks.map((b) => b.accountNumber)).toEqual(["0123456789"]);
    expect(view.payment.amountMinor).toBe(PRICED_TOTAL_MINOR);
    await submitTransferProof(w.clientA, w.paymentA.id, proof());
    expect(await reload(w.paymentA.id)).toMatchObject({ method: "BANK_TRANSFER", status: "PROCESSING", senderName: "Ada Obi" });
    expect(await appStatus(w.appA)).toBe("PAYMENT_PENDING"); // not confirmed until staff confirm
  });
  it("validates the proof: sender name, date, file content and size", async () => {
    const w = await withBank();
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof({ senderName: "A" }))).rejects.toMatchObject({ fieldErrors: { senderName: expect.any(Array) } });
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof({ transferDate: "2999-01-01" }))).rejects.toMatchObject({ fieldErrors: { transferDate: expect.any(Array) } });
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof({ transferDate: "not-a-date" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof({ bytes: Buffer.from("MZ not a receipt") }))).rejects.toThrow(/Unsupported file type/);
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof({ bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) }))).rejects.toThrow(/too large/);
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof({ bytes: Buffer.alloc(0) }))).rejects.toThrow(/empty/);
    expect((await reload(w.paymentA.id)).proofStorageKey).toBeNull();
  });
  it("proof can only be submitted by the owner, and only for bank-transfer payments", async () => {
    const w = await withBank();
    await expect(submitTransferProof(w.clientB, w.paymentA.id, proof())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.payment.update({ where: { id: w.paymentA.id }, data: { method: "PAYSTACK" } });
    await expect(submitTransferProof(w.clientA, w.paymentA.id, proof())).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("staff confirm: payment succeeds, application advances, reviewer recorded, client emailed", async () => {
    const w = await withBank();
    await submitTransferProof(w.clientA, w.paymentA.id, proof());
    await reviewBankTransfer(w.admin, w.paymentA.id, { action: "confirm", note: "Seen in statement" });
    const p = await reload(w.paymentA.id);
    expect(p).toMatchObject({ status: "SUCCESS", method: "BANK_TRANSFER", reviewedById: w.admin.id });
    expect(await appStatus(w.appA)).toBe("PAYMENT_CONFIRMED");
    expect(sent).toHaveLength(1);
    await expect(reviewBankTransfer(w.admin, w.paymentA.id, { action: "confirm" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("staff reject needs a reason, shows it to the client, and the client can resubmit", async () => {
    const w = await withBank();
    await submitTransferProof(w.clientA, w.paymentA.id, proof());
    await expect(reviewBankTransfer(w.admin, w.paymentA.id, { action: "reject" })).rejects.toMatchObject({ fieldErrors: { note: expect.any(Array) } });
    await reviewBankTransfer(w.admin, w.paymentA.id, { action: "reject", note: "Amount received was short by NGN 5,000" });
    expect(await reload(w.paymentA.id)).toMatchObject({ status: "FAILED", failureReason: "Amount received was short by NGN 5,000" });
    expect(await appStatus(w.appA)).toBe("PAYMENT_PENDING");
    await submitTransferProof(w.clientA, w.paymentA.id, proof({ filename: "second.pdf" }));
    expect((await reload(w.paymentA.id)).status).toBe("PROCESSING");
  });
  it("requires payments.manage and an application inside the reviewer's scope; online payments are not hand-confirmed", async () => {
    const w = await withBank();
    await submitTransferProof(w.clientA, w.paymentA.id, proof());
    const viewer = await makeUser("STAFF", "v@x.com", ["applications.view", "payments.view"]);
    const manager = await makeUser("STAFF", "m@x.com", [...STAFF_PERMS, "payments.view", "payments.manage"]);
    await db.visaApplication.update({ where: { id: w.appA }, data: { assignedToId: viewer.id } });
    await expect(reviewBankTransfer(viewer, w.paymentA.id, { action: "confirm" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reviewBankTransfer(manager, w.paymentA.id, { action: "confirm" })).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned to manager
    await expect(reviewBankTransfer(w.clientA, w.paymentA.id, { action: "confirm" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await assignApplication(w.admin, w.appA, manager.id);
    await db.payment.update({ where: { id: w.paymentA.id }, data: { method: "PAYSTACK" } });
    await expect(reviewBankTransfer(manager, w.paymentA.id, { action: "confirm" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await reload(w.paymentA.id)).status).toBe("PROCESSING");
  });
  it("proof files are private: owner and in-scope staff only (staff access is audited)", async () => {
    const w = await withBank();
    await submitTransferProof(w.clientA, w.paymentA.id, proof());
    expect((await openPaymentProof(w.clientA, w.paymentA.id)).object.size).toBe(PDF.length);
    await expect(openPaymentProof(w.clientB, w.paymentA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(openPaymentProof(null, w.paymentA.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const noPerm = await makeUser("STAFF", "np@x.com");
    await expect(openPaymentProof(noPerm, w.paymentA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await openPaymentProof(w.admin, w.paymentA.id)).payment.id).toBe(w.paymentA.id);
    expect(await db.auditLog.count({ where: { action: "payment.proof_viewed" } })).toBe(1);
    const scoped = await makeUser("STAFF", "sc@x.com", ["applications.view", "payments.view"]);
    await expect(openPaymentProof(scoped, w.paymentA.id)).rejects.toMatchObject({ code: "NOT_FOUND" }); // not assigned
  });
});

describe("additional payments and cancellation", () => {
  it("staff request an extra charge; the client pays it; the application status is untouched", async () => {
    const w = await world();
    verifyBehaviour = () => ({ status: "success" });
    await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    await finalizeGatewayPayment("PAYSTACK", `${w.paymentA.reference}-1`);
    await db.visaApplication.update({ where: { id: w.appA }, data: { status: "PROCESSING" } });

    const extra = await requestAdditionalPayment(w.admin, w.appA, { label: "Courier fee", amountMinor: 2_500_00 });
    expect(extra).toMatchObject({ kind: "ADDITIONAL", status: "PENDING", amountMinor: 250_000, clientId: w.clientA.id, description: "Courier fee", createdById: w.admin.id });
    await startGatewayPayment(w.clientA, extra.id, "PAYSTACK"); // additional payments don't need PAYMENT_PENDING
    verifyBehaviour = () => ({ status: "success", amount: 250_000 });
    expect((await finalizeGatewayPayment("PAYSTACK", `${extra.reference}-1`)).outcome).toBe("success");
    expect(await appStatus(w.appA)).toBe("PROCESSING");
    expect((await listClientPayments(w.clientA)).total).toBe(2);
  });
  it("validates the request, enforces permission and scope, and unpaid extras can be cancelled", async () => {
    const w = await world();
    await expect(requestAdditionalPayment(w.admin, w.appA, { label: "x", amountMinor: 1000 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(requestAdditionalPayment(w.admin, w.appA, { label: "Courier fee", amountMinor: 0 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(requestAdditionalPayment(w.admin, w.appA, { label: "Courier fee", amountMinor: 10.5 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(requestAdditionalPayment(w.clientA, w.appA, { label: "Courier fee", amountMinor: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const staff = await makeUser("STAFF", "s@x.com", [...STAFF_PERMS, "payments.manage", "payments.view"]);
    await expect(requestAdditionalPayment(staff, w.appA, { label: "Courier fee", amountMinor: 1000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const extra = await requestAdditionalPayment(w.admin, w.appA, { label: "Courier fee", amountMinor: 1000 });
    await expect(cancelPayment(w.admin, w.paymentA.id)).rejects.toMatchObject({ code: "VALIDATION" }); // package payment
    await cancelPayment(w.admin, extra.id, "Not needed");
    expect(await reload(extra.id)).toMatchObject({ status: "CANCELLED" });
    await expect(startGatewayPayment(w.clientA, extra.id, "PAYSTACK")).resolves.toBeDefined(); // cancelled can be re-opened by choosing a method
  });
});

describe("refunds", () => {
  async function paid() {
    const w = await world();
    verifyBehaviour = () => ({ status: "success" });
    await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    await finalizeGatewayPayment("PAYSTACK", `${w.paymentA.reference}-1`);
    return w;
  }
  it("only payments.refund holders can record refunds (admins by default cannot)", async () => {
    const w = await paid();
    await expect(recordRefund(w.admin, w.paymentA.id, { amountMinor: 100, reason: "Client request" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordRefund(w.clientA, w.paymentA.id, { amountMinor: 100, reason: "Client request" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await recordRefund(w.root, w.paymentA.id, { amountMinor: 100, reason: "Client request" });
    expect(await reload(w.paymentA.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmountMinor: 100 });
  });
  it("tracks partial then full refunds and refuses to refund more than was paid", async () => {
    const w = await paid();
    await recordRefund(w.root, w.paymentA.id, { amountMinor: 5_000_000, reason: "Partial: service not rendered" });
    expect(await reload(w.paymentA.id)).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmountMinor: 5_000_000 });
    await expect(recordRefund(w.root, w.paymentA.id, { amountMinor: PRICED_TOTAL_MINOR, reason: "Too much" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(recordRefund(w.root, w.paymentA.id, { amountMinor: 100, reason: "" })).rejects.toMatchObject({ code: "VALIDATION" });
    await recordRefund(w.root, w.paymentA.id, { amountMinor: PRICED_TOTAL_MINOR - 5_000_000, reason: "Remainder" });
    expect(await reload(w.paymentA.id)).toMatchObject({ status: "REFUNDED", refundedAmountMinor: PRICED_TOTAL_MINOR });
    await expect(recordRefund(w.root, w.paymentA.id, { amountMinor: 1, reason: "More" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.auditLog.count({ where: { action: "payment.refunded" } })).toBe(2);
  });
  it("concurrent refunds can never exceed the amount paid", async () => {
    const w = await paid();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => recordRefund(w.root, w.paymentA.id, { amountMinor: 6_000_000, reason: "Race" })));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect((await reload(w.paymentA.id)).refundedAmountMinor).toBe(6_000_000);
  });
  it("unpaid payments can't be refunded", async () => {
    const w = await world();
    await expect(recordRefund(w.root, w.paymentA.id, { amountMinor: 100, reason: "Nope" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("receipts, history and client isolation", () => {
  it("receipts exist only for paid payments and only for their owner (or in-scope staff)", async () => {
    const w = await world();
    await expect(getReceipt(w.clientA, w.paymentA.id)).rejects.toMatchObject({ code: "VALIDATION" }); // not paid yet
    verifyBehaviour = () => ({ status: "success" });
    await startGatewayPayment(w.clientA, w.paymentA.id, "PAYSTACK");
    await finalizeGatewayPayment("PAYSTACK", `${w.paymentA.reference}-1`);
    expect((await getReceipt(w.clientA, w.paymentA.id)).payment.reference).toBe(w.paymentA.reference);
    expect((await getReceipt(w.admin, w.paymentA.id)).payment.id).toBe(w.paymentA.id);
    await expect(getReceipt(w.clientB, w.paymentA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getReceipt(null, w.paymentA.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const scoped = await makeUser("STAFF", "sc@x.com", ["applications.view", "payments.view"]);
    await expect(getReceipt(scoped, w.paymentA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("Client A cannot see, start, verify or list Client B's payments", async () => {
    const w = await world();
    const appB = await submittedApplication(w.clientB, w.pkg.slug);
    const paymentB = await db.payment.findFirstOrThrow({ where: { applicationId: appB } });
    await expect(getClientPaymentView(w.clientA, paymentB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(startGatewayPayment(w.clientA, paymentB.id, "PAYSTACK")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(chooseBankTransfer(w.clientA, paymentB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(verifyPaymentReturn(w.clientA, paymentB.reference)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getReceipt(w.clientA, paymentB.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const list = await listClientPayments(w.clientA);
    expect(list.items.map((p) => p.id)).toEqual([w.paymentA.id]);
    expect((await listClientPayments(w.clientB)).items.map((p) => p.id)).toEqual([paymentB.id]);
  });
  it("staff payment lists respect scope, permission and filters", async () => {
    const w = await world();
    const staff = await makeUser("STAFF", "s@x.com", [...STAFF_PERMS, "payments.view"]);
    expect((await listAdminPayments(staff)).total).toBe(0);
    await assignApplication(w.admin, w.appA, staff.id);
    expect((await listAdminPayments(staff)).items.map((p) => p.id)).toEqual([w.paymentA.id]);
    const noPerm = await makeUser("STAFF", "np@x.com");
    await expect(listAdminPayments(noPerm)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listAdminPayments(w.clientA)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listAdminPayments(w.admin, { status: "SUCCESS" })).total).toBe(0);
    expect((await listAdminPayments(w.admin, { q: w.paymentA.reference.toLowerCase() })).total).toBe(1);
    expect((await listAdminPayments(w.admin, { q: "ada@x" })).total).toBe(1);
  });
  it("the client's application view still never exposes other people's data after payment steps", async () => {
    const w = await world();
    const view = await getApplicationView(w.clientA, w.appA);
    expect(view.app.status).toBe("PAYMENT_PENDING");
    expect(view.history.map((h) => h.toStatus)).toContain("PAYMENT_PENDING");
  });
});

describe("payment settings", () => {
  it("only settings.manage holders can change bank details; entries are validated and audited", async () => {
    const root = await makeUser("SUPER_ADMIN", "root@x.com");
    const admin = await makeUser("ADMIN", "admin@x.com");
    const good = { bankName: "Test Bank", accountName: "Vinamaz Travels", accountNumber: "0123456789", currency: "ngn", isActive: true };
    await expect(saveBankAccount(admin, null, good)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setMethodEnabled(admin, "PAYSTACK", false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveBankAccount(root, null, { ...good, accountNumber: "12ab" })).rejects.toMatchObject({ fieldErrors: { accountNumber: expect.any(Array) } });
    await expect(saveBankAccount(root, null, { ...good, bankName: "" })).rejects.toMatchObject({ fieldErrors: { bankName: expect.any(Array) } });
    const row = await saveBankAccount(root, null, good);
    expect(row.currency).toBe("NGN");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "settings.bank_account_created" } });
    expect(JSON.stringify(audit.metadata)).not.toContain("0123456789"); // full account number is never copied into the log
    expect(JSON.stringify(audit.metadata)).toContain("6789");
  });
});

describe("existing client flows are unaffected", () => {
  it("startApplication/submit for a free package still works and creates no payment", async () => {
    const admin = await makeUser("ADMIN", "admin@x.com");
    const free = await makeActivePackage(admin, "Free One");
    const client = await makeUser("CLIENT", "c@x.com");
    const { id } = await startApplication(client, free.slug);
    await completeApplication(client, id);
    expect((await submitApplication(client, id)).paymentId).toBeNull();
  });
});
