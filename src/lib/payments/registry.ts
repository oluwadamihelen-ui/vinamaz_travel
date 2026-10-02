import { flutterwave } from "./gateways/flutterwave";
import { korapay } from "./gateways/korapay";
import { paystack } from "./gateways/paystack";
import type { GatewayMethod, PaymentGateway } from "./types";

const GATEWAYS: Record<GatewayMethod, PaymentGateway> = { PAYSTACK: paystack, FLUTTERWAVE: flutterwave, KORAPAY: korapay };

export const GATEWAY_METHODS = Object.keys(GATEWAYS) as GatewayMethod[];

export function getGateway(method: string): PaymentGateway | null {
  return (GATEWAYS as Record<string, PaymentGateway>)[method] ?? null;
}
