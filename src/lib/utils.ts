import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Decimalish = { toString(): string } | number | null | undefined;

/** Format a configured amount; returns null when no amount is configured (never invent one). */
export function formatMoney(amount: Decimalish, currency: string): string | null {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount.toString());
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-NG")}`;
  }
}
