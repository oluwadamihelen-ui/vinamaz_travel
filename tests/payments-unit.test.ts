import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computePackageCharge, formatMinor, toMinor } from "@/lib/payments/amounts";
import { setFetchForTests } from "@/lib/payments/http";
import { getGateway } from "@/lib/payments/registry";
import { hmacBase64, hmacHex } from "@/lib/payments/signatures";
import { GatewayError } from "@/lib/payments/types";
import { buildReceiptPdf } from "@/lib/payments/receipt-pdf";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mockFetch = (fn: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => fn(String(url), init ?? {}));
  setFetchForTests(spy as unknown as typeof fetch);
  return spy;
};
afterEach(() => setFetchForTests(undefined));

describe("amounts", () => {
  it("converts decimals to minor units exactly (no floating-point drift)", () => {
    expect(toMinor("150000")).toBe(15_000_000);
    expect(toMinor("150000.50")).toBe(15_000_050);
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor("19.99")).toBe(1999);
    expect(toMinor("1.005")).toBe(101); // half-up
    expect(toMinor(null)).toBe(0);
    expect(toMinor("abc")).toBe(0);
    expect(toMinor("-5")).toBe(0);
  });
  it("sums only the configured fees and never invents any", () => {
    expect(computePackageCharge({ price: "150000", applicationFee: null, serviceFee: "5000", currency: "NGN" })).toEqual({
      items: [{ label: "Package price", amountMinor: 15_000_000 }, { label: "Service fee", amountMinor: 500_000 }], totalMinor: 15_500_000, currency: "NGN",
    });
    expect(computePackageCharge({ price: null, applicationFee: null, serviceFee: null, currency: "NGN" }).totalMinor).toBe(0);
    expect(computePackageCharge({ price: "0", applicationFee: "0", serviceFee: "0", currency: "NGN" }).items).toEqual([]);
  });
  it("formats minor units", () => {
    expect(formatMinor(15_500_000, "NGN")).toContain("155,000");
    expect(formatMinor(1999, "USD")).toContain("19.99");
  });
});

describe("Paystack adapter", () => {
  const g = getGateway("PAYSTACK")!;
  const body = (o: object) => JSON.stringify(o);
  it("initialises with the amount in kobo and our reference, authenticated with the secret key", async () => {
    const spy = mockFetch(() => json({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "abc", reference: "R-1" } }));
    const res = await g.initialize({ reference: "VNZ-PAY-X-1", amountMinor: 15_500_000, currency: "NGN", customer: { email: "a@b.com", name: "Ada" }, description: "Fees", callbackUrl: "https://vinamaz.test/cb", webhookUrl: "https://vinamaz.test/w" });
    expect(res.checkoutUrl).toBe("https://checkout.paystack.com/abc");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test_paystack_secret");
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 15_500_000, currency: "NGN", reference: "VNZ-PAY-X-1", email: "a@b.com", callback_url: "https://vinamaz.test/cb" });
  });
  it("maps verify results and treats an unknown reference as pending", async () => {
    mockFetch(() => json({ status: true, data: { status: "success", reference: "R", amount: 100, currency: "NGN" } }));
    expect(await g.verify("R")).toMatchObject({ status: "success", amountMinor: 100, currency: "NGN", reference: "R" });
    mockFetch(() => json({ status: true, data: { status: "abandoned", reference: "R", amount: 100, currency: "NGN" } }));
    expect((await g.verify("R")).status).toBe("failed");
    mockFetch(() => json({ status: true, data: { status: "ongoing", reference: "R", amount: 100, currency: "NGN" } }));
    expect((await g.verify("R")).status).toBe("pending");
    mockFetch(() => json({ status: false, message: "Transaction reference not found" }, 404));
    expect((await g.verify("R")).status).toBe("pending");
    mockFetch(() => json({ message: "boom" }, 500));
    await expect(g.verify("R")).rejects.toBeInstanceOf(GatewayError);
  });
  it("initialise failures never leak the secret key", async () => {
    mockFetch(() => json({ status: false, message: "Invalid key" }, 401));
    const err = await g.initialize({ reference: "r", amountMinor: 1, currency: "NGN", customer: { email: "a@b.com", name: "A" }, description: "d", callbackUrl: "x", webhookUrl: "y" }).then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err!.message).not.toContain("sk_test_paystack_secret");
  });
  it("verifies webhook signatures (HMAC-SHA512 of the raw body) and rejects tampering", () => {
    const raw = body({ event: "charge.success", data: { id: 99, reference: "VNZ-PAY-X-1", amount: 5 } });
    const sign = (b: string, key = "sk_test_paystack_secret") => new Headers({ "x-paystack-signature": hmacHex("sha512", key, b) });
    expect(g.checkWebhook(raw, sign(raw))).toEqual({ valid: true, event: { type: "success", reference: "VNZ-PAY-X-1", eventKey: "charge.success:99" } });
    expect(g.checkWebhook(raw + " ", sign(raw)).valid).toBe(false); // body changed after signing
    expect(g.checkWebhook(raw, sign(raw, "wrong-key")).valid).toBe(false);
    expect(g.checkWebhook(raw, new Headers()).valid).toBe(false);
    const other = body({ event: "transfer.success", data: {} });
    expect(g.checkWebhook(other, sign(other))).toEqual({ valid: true, event: { type: "ignored" } });
  });
});

describe("Flutterwave adapter", () => {
  const g = getGateway("FLUTTERWAVE")!;
  it("initialises in major units and returns the hosted link", async () => {
    const spy = mockFetch(() => json({ status: "success", data: { link: "https://checkout.flutterwave.com/v3/hosted/pay/xyz" } }));
    const res = await g.initialize({ reference: "VNZ-PAY-X-1", amountMinor: 15_500_050, currency: "NGN", customer: { email: "a@b.com", name: "Ada", phone: "+2348000000000" }, description: "Fees", callbackUrl: "https://vinamaz.test/cb", webhookUrl: "w" });
    expect(res.checkoutUrl).toContain("flutterwave.com");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.flutterwave.com/v3/payments");
    expect(JSON.parse(init.body as string)).toMatchObject({ tx_ref: "VNZ-PAY-X-1", amount: 155000.5, currency: "NGN", redirect_url: "https://vinamaz.test/cb" });
  });
  it("verifies by our tx_ref and converts the amount back to minor units", async () => {
    const spy = mockFetch(() => json({ status: "success", data: { status: "successful", tx_ref: "VNZ-PAY-X-1", amount: 155000.5, currency: "NGN", id: 7 } }));
    expect(await g.verify("VNZ-PAY-X-1")).toMatchObject({ status: "success", amountMinor: 15_500_050, currency: "NGN", reference: "VNZ-PAY-X-1" });
    expect(String(spy.mock.calls[0]![0])).toContain("verify_by_reference?tx_ref=VNZ-PAY-X-1");
    mockFetch(() => json({ status: "success", data: { status: "failed", tx_ref: "r", amount: 1, currency: "NGN" } }));
    expect((await g.verify("r")).status).toBe("failed");
    mockFetch(() => json({ status: "error", message: "No transaction was found" }, 400));
    expect((await g.verify("r")).status).toBe("pending");
  });
  it("accepts the secret-hash header or the HMAC signature, and nothing else", () => {
    const raw = JSON.stringify({ event: "charge.completed", data: { id: 5, tx_ref: "VNZ-PAY-X-1", status: "successful" } });
    const ok = { type: "success", reference: "VNZ-PAY-X-1", eventKey: "charge.completed:5" };
    expect(g.checkWebhook(raw, new Headers({ "verif-hash": "flw-webhook-secret-hash" }))).toEqual({ valid: true, event: ok });
    expect(g.checkWebhook(raw, new Headers({ "flutterwave-signature": hmacBase64("sha256", "flw-webhook-secret-hash", raw) }))).toEqual({ valid: true, event: ok });
    expect(g.checkWebhook(raw, new Headers({ "verif-hash": "nope" })).valid).toBe(false);
    expect(g.checkWebhook(raw, new Headers({ "flutterwave-signature": hmacBase64("sha256", "wrong", raw) })).valid).toBe(false);
    expect(g.checkWebhook(raw, new Headers()).valid).toBe(false);
    const failed = JSON.stringify({ event: "charge.completed", data: { id: 6, tx_ref: "r", status: "failed" } });
    expect(g.checkWebhook(failed, new Headers({ "verif-hash": "flw-webhook-secret-hash" })).event).toMatchObject({ type: "failed" });
  });
});

describe("Korapay adapter", () => {
  const g = getGateway("KORAPAY")!;
  it("initialises with major units, our reference and the webhook URL", async () => {
    const spy = mockFetch(() => json({ status: true, data: { reference: "VNZ-PAY-X-1", checkout_url: "https://checkout.korapay.com/pay/abc" } }));
    const res = await g.initialize({ reference: "VNZ-PAY-X-1", amountMinor: 15_500_000, currency: "NGN", customer: { email: "a@b.com", name: "Ada" }, description: "Fees", callbackUrl: "https://vinamaz.test/cb", webhookUrl: "https://vinamaz.test/api/webhooks/korapay" });
    expect(res.checkoutUrl).toBe("https://checkout.korapay.com/pay/abc");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.korapay.com/merchant/api/v1/charges/initialize");
    expect(JSON.parse(init.body as string)).toMatchObject({ reference: "VNZ-PAY-X-1", amount: 155000, currency: "NGN", redirect_url: "https://vinamaz.test/cb", notification_url: "https://vinamaz.test/api/webhooks/korapay" });
  });
  it("maps verify statuses", async () => {
    mockFetch(() => json({ status: true, data: { status: "success", reference: "R", amount: 155000, currency: "NGN" } }));
    expect(await g.verify("R")).toMatchObject({ status: "success", amountMinor: 15_500_000 });
    mockFetch(() => json({ status: true, data: { status: "processing", reference: "R", amount: 1, currency: "NGN" } }));
    expect((await g.verify("R")).status).toBe("pending");
    mockFetch(() => json({ status: false }, 404));
    expect((await g.verify("R")).status).toBe("pending");
  });
  it("signs only the data object (HMAC-SHA256 hex) and rejects tampering", () => {
    const payload = { event: "charge.success", data: { reference: "VNZ-PAY-X-1", amount: 155000, status: "success" } };
    const raw = JSON.stringify(payload);
    const sig = (data: unknown, key = "sk_test_korapay_secret") => new Headers({ "x-korapay-signature": hmacHex("sha256", key, JSON.stringify(data)) });
    expect(g.checkWebhook(raw, sig(payload.data))).toEqual({ valid: true, event: { type: "success", reference: "VNZ-PAY-X-1", eventKey: "charge.success:VNZ-PAY-X-1" } });
    const tampered = JSON.stringify({ ...payload, data: { ...payload.data, amount: 1 } });
    expect(g.checkWebhook(tampered, sig(payload.data)).valid).toBe(false);
    expect(g.checkWebhook(raw, sig(payload.data, "wrong")).valid).toBe(false);
    expect(g.checkWebhook("not json", sig(payload.data)).valid).toBe(false);
  });
});

describe("gateway configuration and currencies", () => {
  const saved = { ...process.env };
  beforeEach(() => { Object.assign(process.env, saved); });
  afterEach(() => { Object.assign(process.env, saved); });
  it("a gateway without its secret is not configured; Flutterwave also needs its webhook hash", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(getGateway("PAYSTACK")!.isConfigured()).toBe(false);
    delete process.env.FLUTTERWAVE_SECRET_HASH;
    expect(getGateway("FLUTTERWAVE")!.isConfigured()).toBe(false);
    expect(getGateway("KORAPAY")!.isConfigured()).toBe(true);
    expect(getGateway("NOPE")).toBeNull();
  });
  it("only offers a gateway for currencies it supports", () => {
    expect(getGateway("KORAPAY")!.supportsCurrency("NGN")).toBe(true);
    expect(getGateway("KORAPAY")!.supportsCurrency("EUR")).toBe(false);
    expect(getGateway("FLUTTERWAVE")!.supportsCurrency("GBP")).toBe(true);
  });
});

describe("receipt pdf", () => {
  it("renders a valid PDF even with non-Latin names", async () => {
    const pdf = await buildReceiptPdf({
      reference: "VNZ-PAY-ABC", status: "SUCCESS", method: "PAYSTACK", paidAt: new Date("2026-03-01T10:00:00Z"), currency: "NGN", amountMinor: 15_500_000, refundedAmountMinor: 500_000,
      items: [{ label: "Package price", amountMinor: 15_000_000 }, { label: "Service fee", amountMinor: 500_000 }], clientName: "Ṣọlá Àdé 王", clientEmail: "a@b.com", applicationNumber: "VNZ-2026-000001", packageName: "Canada Visa Assistance",
    });
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
