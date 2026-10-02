import { asRecord, gatewayRequest } from "../http";
import { hmacHex, safeEqual } from "../signatures";
import { GatewayError, type PaymentGateway, type WebhookCheck } from "../types";

// Overridable for sandbox/mock testing; defaults to the live API.
const base = () => (process.env.PAYSTACK_API_BASE ?? "https://api.paystack.co").replace(/\/$/, "");
// Currencies Paystack accounts can commonly charge; each merchant account must still have them enabled.
const CURRENCIES = ["NGN", "GHS", "ZAR", "KES", "USD"];
const secret = () => process.env.PAYSTACK_SECRET_KEY ?? "";

export const paystack: PaymentGateway = {
  method: "PAYSTACK",
  label: "Paystack",
  supportsCurrency: (c) => CURRENCIES.includes(c),
  defaultCurrencies: () => CURRENCIES,
  isConfigured: () => secret().length > 0,

  async initialize(i) {
    const { status, json } = await gatewayRequest(`${base()}/transaction/initialize`, {
      method: "POST", secret: secret(),
      body: { email: i.customer.email, amount: i.amountMinor, currency: i.currency, reference: i.reference, callback_url: i.callbackUrl, metadata: { description: i.description, customer_name: i.customer.name } },
    });
    const data = asRecord(json.data);
    if (status >= 400 || json.status !== true || typeof data.authorization_url !== "string") {
      throw new GatewayError(`Paystack could not start the payment${typeof json.message === "string" ? `: ${json.message}` : ""}`, status);
    }
    return { checkoutUrl: data.authorization_url, raw: { status: json.status, reference: data.reference ?? i.reference, access_code: data.access_code } };
  },

  async verify(reference) {
    const { status, json } = await gatewayRequest(`${base()}/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET", secret: secret() });
    if (status === 404) return { status: "pending", reference, amountMinor: null, currency: null, raw: { notFound: true } }; // customer hasn't started paying
    const data = asRecord(json.data);
    if (status >= 400 || json.status !== true) throw new GatewayError("Paystack could not verify the transaction.", status);
    const s = String(data.status ?? "");
    return {
      status: s === "success" ? "success" : ["failed", "abandoned", "reversed"].includes(s) ? "failed" : "pending",
      reference: typeof data.reference === "string" ? data.reference : null,
      amountMinor: typeof data.amount === "number" ? data.amount : null,
      currency: typeof data.currency === "string" ? data.currency : null,
      raw: { status: s, gateway_response: data.gateway_response, paid_at: data.paid_at, channel: data.channel, id: data.id },
    };
  },

  async refund(i) {
    const { status, json } = await gatewayRequest(`${base()}/refund`, {
      method: "POST", secret: secret(),
      body: { transaction: i.reference, amount: i.amountMinor, currency: i.currency, merchant_note: i.reason.slice(0, 200) },
    });
    const data = asRecord(json.data);
    if (status >= 400 || json.status !== true) {
      throw new GatewayError(`Paystack declined the refund${typeof json.message === "string" ? `: ${json.message}` : ""}`, status);
    }
    const s = String(data.status ?? "pending");
    return { status: s === "processed" ? "processed" : "pending", gatewayRefundId: data.id !== undefined ? String(data.id) : null, raw: { status: s, id: data.id } };
  },

  checkWebhook(rawBody, headers): WebhookCheck {
    const sig = headers.get("x-paystack-signature") ?? "";
    if (!secret() || !sig || !safeEqual(sig, hmacHex("sha512", secret(), rawBody))) return { valid: false };
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); } catch { return { valid: true, event: { type: "ignored" } }; }
    const data = asRecord(body.data);
    if (body.event === "charge.success" && typeof data.reference === "string") {
      return { valid: true, event: { type: "success", reference: data.reference, eventKey: `charge.success:${String(data.id ?? data.reference)}` } };
    }
    return { valid: true, event: { type: "ignored" } };
  },
};
