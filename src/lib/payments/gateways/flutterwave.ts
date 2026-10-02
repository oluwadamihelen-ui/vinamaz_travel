import { asRecord, gatewayRequest } from "../http";
import { hmacBase64, safeEqual } from "../signatures";
import { GatewayError, type PaymentGateway, type WebhookCheck } from "../types";

// Overridable for sandbox/mock testing; defaults to the live API.
const base = () => (process.env.FLUTTERWAVE_API_BASE ?? "https://api.flutterwave.com/v3").replace(/\/$/, "");
const CURRENCIES = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR", "UGX", "TZS", "RWF", "XOF", "XAF"];
const secret = () => process.env.FLUTTERWAVE_SECRET_KEY ?? "";
/** The "secret hash" you set in the Flutterwave dashboard (Settings → Webhooks). */
const hash = () => process.env.FLUTTERWAVE_SECRET_HASH ?? "";

export const flutterwave: PaymentGateway = {
  method: "FLUTTERWAVE",
  label: "Flutterwave",
  supportsCurrency: (c) => CURRENCIES.includes(c),
  defaultCurrencies: () => CURRENCIES,
  isConfigured: () => secret().length > 0 && hash().length > 0,

  async initialize(i) {
    const { status, json } = await gatewayRequest(`${base()}/payments`, {
      method: "POST", secret: secret(),
      body: {
        tx_ref: i.reference, amount: i.amountMinor / 100, currency: i.currency, redirect_url: i.callbackUrl,
        customer: { email: i.customer.email, name: i.customer.name, phonenumber: i.customer.phone ?? undefined },
        customizations: { title: "Vinamaz Travels", description: i.description },
      },
    });
    const data = asRecord(json.data);
    if (status >= 400 || json.status !== "success" || typeof data.link !== "string") {
      throw new GatewayError(`Flutterwave could not start the payment${typeof json.message === "string" ? `: ${json.message}` : ""}`, status);
    }
    return { checkoutUrl: data.link, raw: { status: json.status, tx_ref: i.reference } };
  },

  async verify(reference) {
    const { status, json } = await gatewayRequest(`${base()}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { method: "GET", secret: secret() });
    if (status === 404 || (json.status === "error" && status < 500)) return { status: "pending", reference, amountMinor: null, currency: null, raw: { notFound: true } };
    if (status >= 400) throw new GatewayError("Flutterwave could not verify the transaction.", status);
    const data = asRecord(json.data);
    const s = String(data.status ?? "");
    return {
      status: s === "successful" ? "success" : s === "failed" ? "failed" : "pending",
      reference: typeof data.tx_ref === "string" ? data.tx_ref : null,
      amountMinor: typeof data.amount === "number" ? Math.round(data.amount * 100) : null,
      currency: typeof data.currency === "string" ? data.currency : null,
      raw: { status: s, processor_response: data.processor_response, payment_type: data.payment_type, id: data.id },
    };
  },

  async refund(i) {
    if (!i.gatewayTransactionId || !/^\d+$/.test(i.gatewayTransactionId)) throw new GatewayError("Flutterwave needs the transaction id of the original charge; verify the payment first.");
    const { status, json } = await gatewayRequest(`${base()}/transactions/${i.gatewayTransactionId}/refund`, { method: "POST", secret: secret(), body: { amount: i.amountMinor / 100 } });
    const data = asRecord(json.data);
    if (status >= 400 || json.status !== "success") {
      throw new GatewayError(`Flutterwave declined the refund${typeof json.message === "string" ? `: ${json.message}` : ""}`, status);
    }
    const s = String(data.status ?? "pending");
    return { status: s === "completed" ? "processed" : "pending", gatewayRefundId: data.id !== undefined ? String(data.id) : null, raw: { status: s, id: data.id } };
  },

  checkWebhook(rawBody, headers): WebhookCheck {
    // Flutterwave signs webhooks either by echoing the secret hash (`verif-hash`) or with an HMAC (`flutterwave-signature`).
    const plain = headers.get("verif-hash") ?? "";
    const hmac = headers.get("flutterwave-signature") ?? "";
    const ok = hash().length > 0 && ((plain && safeEqual(plain, hash())) || (hmac && safeEqual(hmac, hmacBase64("sha256", hash(), rawBody))));
    if (!ok) return { valid: false };
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); } catch { return { valid: true, event: { type: "ignored" } }; }
    const data = asRecord(body.data);
    const ref = typeof data.tx_ref === "string" ? data.tx_ref : null;
    if (!ref || (body.event !== "charge.completed" && body.type !== "CARD_TRANSACTION" && !String(body.event ?? "").startsWith("charge"))) return { valid: true, event: { type: "ignored" } };
    const s = String(data.status ?? "");
    const key = `${String(body.event ?? "charge")}:${String(data.id ?? ref)}`;
    if (s === "successful") return { valid: true, event: { type: "success", reference: ref, eventKey: key } };
    if (s === "failed") return { valid: true, event: { type: "failed", reference: ref, eventKey: key } };
    return { valid: true, event: { type: "ignored" } };
  },
};
