import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentKind } from "@/generated/prisma/enums";
import type { LineItem } from "./amounts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

export function generatePaymentReference(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return `VNZ-PAY-${out}`;
}

export interface NewPayment {
  applicationId: string;
  clientId: string;
  kind: PaymentKind;
  description: string;
  items: LineItem[];
  currency: string;
  createdById?: string | null;
}

/** Create a PENDING payment with a unique reference (retries on the astronomically unlikely collision). */
export async function createPaymentRow(tx: Prisma.TransactionClient, p: NewPayment) {
  const amountMinor = p.items.reduce((n, i) => n + i.amountMinor, 0);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new Error("A payment needs a positive amount");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await tx.payment.create({
        data: {
          reference: generatePaymentReference(), applicationId: p.applicationId, clientId: p.clientId, kind: p.kind,
          description: p.description, lineItems: p.items as unknown as Prisma.InputJsonValue, amountMinor, currency: p.currency, createdById: p.createdById ?? null,
        },
      });
    } catch (e) {
      const dupRef = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target ?? "").includes("reference");
      if (!dupRef) throw e;
    }
  }
  throw new Error("Could not allocate a payment reference");
}
