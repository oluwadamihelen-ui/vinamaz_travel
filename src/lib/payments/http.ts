import { GatewayError } from "./types";

let fetchImpl: typeof fetch | undefined;

/** Test seam: replace the HTTP client. */
export function setFetchForTests(f: typeof fetch | undefined) {
  fetchImpl = f;
}

/** JSON request to a gateway with a timeout. Error messages never include secrets or request headers. */
export async function gatewayRequest(url: string, init: { method: "GET" | "POST"; secret: string; body?: unknown }): Promise<{ status: number; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await (fetchImpl ?? fetch)(url, {
      method: init.method,
      headers: { Authorization: `Bearer ${init.secret}`, "Content-Type": "application/json", Accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, json };
  } catch (e) {
    throw new GatewayError(e instanceof Error && e.name === "AbortError" ? "The payment provider timed out." : "Could not reach the payment provider.");
  } finally {
    clearTimeout(timer);
  }
}

export const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
