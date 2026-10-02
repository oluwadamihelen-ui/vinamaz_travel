"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { toMinor } from "@/lib/payments/amounts";
import {
  cancelPayment, chooseBankTransfer, recordRefund, requestAdditionalPayment, reviewBankTransfer, startGatewayPayment,
} from "@/lib/services/payments";
import { deleteBankAccount, saveBankAccount, setMethodEnabled } from "@/lib/services/payment-settings";
import type { PaymentMethod } from "@/generated/prisma/enums";

export interface PayState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
  /** Set when the browser should leave for the gateway's hosted checkout. */
  redirectTo?: string;
}

async function run(fn: (actor: NonNullable<Awaited<ReturnType<typeof getActor>>>) => Promise<Partial<PayState> | void>, paths: string[]): Promise<PayState> {
  try {
    const actor = await getActor();
    if (!actor) return { error: "Please sign in to continue." };
    const out = (await fn(actor)) ?? {};
    for (const p of paths) revalidatePath(p);
    return { ok: true, ...out };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors };
    console.error("[payment action]", e);
    return { error: "Something went wrong. Please try again." };
  }
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** Client: pay with an online gateway. Only the payment id and chosen method come from the browser. */
export async function payOnlineAction(paymentId: string, method: string): Promise<PayState> {
  return run(async (actor) => {
    const { checkoutUrl } = await startGatewayPayment(actor, paymentId, method);
    return { redirectTo: checkoutUrl };
  }, [`/client/payments/${paymentId}`]);
}

export async function chooseBankTransferAction(paymentId: string): Promise<PayState> {
  return run(async (actor) => { await chooseBankTransfer(actor, paymentId); }, [`/client/payments/${paymentId}`]);
}

// ---- Staff ----------------------------------------------------------------

export async function reviewTransferAction(paymentId: string, action: "confirm" | "reject", _prev: PayState, formData: FormData): Promise<PayState> {
  return run(async (actor) => {
    await reviewBankTransfer(actor, paymentId, { action, note: str(formData.get("note")) });
    return { message: action === "confirm" ? "Payment confirmed." : "Transfer rejected. The client has been asked to resubmit." };
  }, [`/admin/payments/${paymentId}`, "/admin/payments"]);
}

export async function requestExtraPaymentAction(applicationId: string, _prev: PayState, formData: FormData): Promise<PayState> {
  const amountMinor = toMinor(str(formData.get("amount")).replace(/,/g, ""));
  return run(async (actor) => {
    await requestAdditionalPayment(actor, applicationId, { label: str(formData.get("label")), amountMinor });
    return { message: "Payment requested. The client will see it on their dashboard." };
  }, [`/admin/applications/${applicationId}`, "/admin/payments"]);
}

export async function cancelPaymentAction(paymentId: string, applicationId: string, _prev: PayState, formData: FormData): Promise<PayState> {
  return run(async (actor) => { await cancelPayment(actor, paymentId, str(formData.get("reason"))); return { message: "Payment cancelled." }; }, [`/admin/payments/${paymentId}`, `/admin/applications/${applicationId}`]);
}

export async function refundAction(paymentId: string, _prev: PayState, formData: FormData): Promise<PayState> {
  const amountMinor = toMinor(str(formData.get("amount")).replace(/,/g, ""));
  return run(async (actor) => {
    await recordRefund(actor, paymentId, { amountMinor, reason: str(formData.get("reason")) });
    return { message: "Refund recorded." };
  }, [`/admin/payments/${paymentId}`, "/admin/payments"]);
}

export async function toggleMethodAction(method: PaymentMethod, enabled: boolean): Promise<PayState> {
  return run(async (actor) => { await setMethodEnabled(actor, method, enabled); }, ["/admin/settings"]);
}

export async function saveBankAccountAction(id: string | null, _prev: PayState, formData: FormData): Promise<PayState> {
  return run(async (actor) => {
    await saveBankAccount(actor, id, {
      bankName: str(formData.get("bankName")), accountName: str(formData.get("accountName")), accountNumber: str(formData.get("accountNumber")),
      currency: str(formData.get("currency")) || "NGN", instructions: str(formData.get("instructions")), isActive: formData.get("isActive") === "on",
    });
    return { message: "Saved." };
  }, ["/admin/settings"]);
}

export async function deleteBankAccountAction(id: string): Promise<PayState> {
  return run(async (actor) => { await deleteBankAccount(actor, id); }, ["/admin/settings"]);
}
