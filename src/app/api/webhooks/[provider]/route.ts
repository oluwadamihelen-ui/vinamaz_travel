import { GATEWAY_METHODS } from "@/lib/payments/registry";
import type { GatewayMethod } from "@/lib/payments/types";
import { handleGatewayWebhook } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

const MAX_BODY = 256 * 1024;

/**
 * Gateway webhooks (/api/webhooks/paystack | flutterwave | korapay). The signature is checked on the
 * RAW body before anything is parsed, and the payment is then confirmed by asking the gateway's
 * verify API; nothing in the webhook body is trusted for amount, currency or status.
 */
export async function POST(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const provider = (await ctx.params).provider.toUpperCase();
  if (!(GATEWAY_METHODS as string[]).includes(provider)) return new Response("not found", { status: 404 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return new Response("payload too large", { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response("payload too large", { status: 413 });
  try {
    const res = await handleGatewayWebhook(provider as GatewayMethod, raw, request.headers);
    return new Response(res.body, { status: res.status });
  } catch (e) {
    console.error("[webhook]", provider, e instanceof Error ? e.message : e);
    return new Response("error", { status: 500 }); // gateways retry on 5xx
  }
}
