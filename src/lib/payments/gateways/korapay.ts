import { asRecord, gatewayRequest } from "../http";
import { hmacHex, safeEqual } from "../signatures";
import { GatewayError, type PaymentGateway, type WebhookCheck } from "../types";

// Overridable for sandbox/mock testing; defaults to the live API.
const base = () => (process.env.KORAPAY_API_BASE ?? "https://api.korapay.com/merchant/api/v1").replace(/\/$/, "");
const CURRENCIES = ["NGN", "KES", "GHS"];
const secret = () => process.env.KORAPAY_SECRET_KEY ?? "";

export const korapay: PaymentGateway = {
  method: "KORAPAY",
  label: "Korapay",
  supportsCurrency: (c) => CURRENCIES.includes(c),
  defaultCurrencies: () => CURRENCIES,
  isConfigured: () => secret().length > 0,

  async initialize(i) {
    const { status, json } = await gatewayRequest(`${base()}/charges/initialize`, {
      method: "POST", secret: secret(),
      body: {
        reference: i.reference, amount: i.amountMinor / 100, currency: i.currency, redirect_url: i.callbackUrl, notification_url: i.webhookUrl,
        narration: i.description.slice(0, 100), customer: { name: i.customer.name, email: i.customer.email },
      },
    });
    const data = asRecord(json.data);
    if (status >= 400 || json.status !== true || typeof data.checkout_url !== "string") {
      throw new GatewayError(`Korapay could not start the payment${typeof json.message === "string" ? `: ${json.message}` : ""}`, status);
    }
    return { checkoutUrl: data.checkout_url, raw: { status: json.status, reference: data.reference ?? i.reference } };
  },

  async verify(reference) {
    const { status, json } = await gatewayRequest(`${base()}/charges/${encodeURIComponent(reference)}`, { method: "GET", secret: secret() });
    if (status === 404) return { status: "pending", reference, amountMinor: null, currency: null, raw: { notFound: true } };
    if (status >= 400) throw new GatewayError("Korapay could not verify the transaction.", status);
    const data = asRecord(json.data);
    const s = String(data.status ?? "");
    return {
      status: s === "success" ? "success" : s === "failed" ? "failed" : "pending",
      reference: typeof data.reference === "string" ? data.reference : null,
      amountMinor: typeof data.amount === "number" ? Math.round(data.amount * 100) : typeof data.amount === "string" ? Math.round(Number(data.amount) * 100) : null,
      currency: typeof data.currency === "string" ? data.currency : null,
      raw: { status: s, payment_method: data.payment_method, transaction_date: data.transaction_date },
    };
  },

  checkWebhook(rawBody, headers): WebhookCheck {
    // Korapay signs only the `data` object of the payload (HMAC-SHA256 with the secret key, hex).
    const sig = headers.get("x-korapay-signature") ?? "";
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody); } catch { return { valid: false }; }
    if (!secret() || !sig || !safeEqual(sig, hmacHex("sha256", secret(), JSON.stringify(body.data)))) return { valid: false };
    const data = asRecord(body.data);
    const ref = typeof data.reference === "string" ? data.reference : null;
    if (ref && body.event === "charge.success") return { valid: true, event: { type: "success", reference: ref, eventKey: `charge.success:${ref}` } };
    if (ref && body.event === "charge.failed") return { valid: true, event: { type: "failed", reference: ref, eventKey: `charge.failed:${ref}` } };
    return { valid: true, event: { type: "ignored" } };
  },
};
