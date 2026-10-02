/**
 * Money helpers. All stored amounts are integers in MINOR units (kobo / cents), so no floating-point
 * arithmetic ever touches a payment amount.
 */
export interface LineItem {
  label: string;
  amountMinor: number;
}

type Decimalish = { toString(): string } | number | string | null | undefined;

/** Exact decimal string -> minor units (rounded half-up beyond 2 decimals). null/blank/invalid -> 0. */
export function toMinor(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  const s = value.toString().trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return 0;
  const whole = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(3, "0");
  let minor = whole * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) minor += 1;
  return minor;
}

export const minorToMajor = (minor: number): number => minor / 100;

export function formatMinor(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: major % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  }
}

export interface ChargeablePackage {
  price: Decimalish;
  applicationFee: Decimalish;
  serviceFee: Decimalish;
  currency: string;
}

/** What a client owes for a package: each configured fee as a line item. Unconfigured fees are skipped (never invented). */
export function computePackageCharge(pkg: ChargeablePackage): { items: LineItem[]; totalMinor: number; currency: string } {
  const items: LineItem[] = [];
  const add = (label: string, v: Decimalish) => {
    const amountMinor = toMinor(v);
    if (amountMinor > 0) items.push({ label, amountMinor });
  };
  add("Package price", pkg.price);
  add("Application fee", pkg.applicationFee);
  add("Service fee", pkg.serviceFee);
  return { items, totalMinor: items.reduce((n, i) => n + i.amountMinor, 0), currency: pkg.currency };
}
