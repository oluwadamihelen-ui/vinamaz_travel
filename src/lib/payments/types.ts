import type { PaymentMethod } from "@/generated/prisma/enums";

export type GatewayMethod = Exclude<PaymentMethod, "BANK_TRANSFER">;

export interface GatewayInitInput {
  /** Our unique reference for THIS attempt (sent to the gateway). */
  reference: string;
  amountMinor: number;
  currency: string;
  customer: { email: string; name: string; phone?: string | null };
  description: string;
  callbackUrl: string;
  /** Server-to-server webhook URL (used by gateways that take it per request). */
  webhookUrl: string;
}

export interface GatewayInitResult {
  checkoutUrl: string;
  /** Sanitised gateway response, stored in the transaction log. */
  raw: unknown;
}

export type GatewayVerifyStatus = "success" | "failed" | "pending";

export interface GatewayVerifyResult {
  status: GatewayVerifyStatus;
  reference: string | null;
  amountMinor: number | null;
  currency: string | null;
  raw: unknown;
}

export type WebhookEvent =
  | { type: "success" | "failed"; reference: string; eventKey: string }
  | { type: "ignored" };

export interface WebhookCheck {
  valid: boolean;
  event?: WebhookEvent;
}

export interface GatewayRefundInput {
  /** Our reference that was sent to the gateway when the charge was created. */
  reference: string;
  /** The gateway's own transaction id, taken from the verified charge (needed by Flutterwave). */
  gatewayTransactionId: string | null;
  amountMinor: number;
  currency: string;
  reason: string;
}

export interface GatewayRefundResult {
  /** "pending" = accepted by the gateway and being processed. */
  status: "pending" | "processed";
  gatewayRefundId: string | null;
  raw: unknown;
}

/** Everything the payment service needs from a provider. Providers are interchangeable behind this. */
export interface PaymentGateway {
  readonly method: GatewayMethod;
  readonly label: string;
  /** Currencies we are willing to offer this gateway for. */
  supportsCurrency(currency: string): boolean;
  /** The built-in currency list (shown in settings so an administrator can override it). */
  defaultCurrencies(): readonly string[];
  /** True when the required secrets are present in the environment. */
  isConfigured(): boolean;
  initialize(input: GatewayInitInput): Promise<GatewayInitResult>;
  /** Ask the gateway for the truth about a transaction. The only thing that can mark a payment paid. */
  verify(reference: string): Promise<GatewayVerifyResult>;
  /** Check the webhook's authenticity and extract the event. Never trust the body before `valid` is true. */
  checkWebhook(rawBody: string, headers: Headers): WebhookCheck;
  /** Optional: ask the gateway to send money back. Gateways without this are record-only. */
  refund?(input: GatewayRefundInput): Promise<GatewayRefundResult>;
}

export class GatewayError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "GatewayError";
  }
}
