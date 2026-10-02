import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (different lengths are simply unequal). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hmacHex = (algo: "sha256" | "sha512", key: string, data: string) => createHmac(algo, key).update(data).digest("hex");
export const hmacBase64 = (algo: "sha256" | "sha512", key: string, data: string) => createHmac(algo, key).update(data).digest("base64");
