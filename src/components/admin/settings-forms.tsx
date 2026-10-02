"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { deleteBankAccountAction, saveBankAccountAction, toggleMethodAction, type PayState } from "@/lib/actions/payments";
import type { PaymentMethod } from "@/generated/prisma/enums";

const init: PayState = {};

export function MethodToggle({ method, enabled, disabled }: { method: PaymentMethod; enabled: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant={enabled ? "outline" : "primary"} disabled={pending || disabled} onClick={() => start(async () => { await toggleMethodAction(method, !enabled); })}>
      {pending ? "…" : enabled ? "Turn off" : "Turn on"}
    </Button>
  );
}

export function BankAccountForm({ id, initial }: { id: string | null; initial?: { bankName: string; accountName: string; accountNumber: string; currency: string; instructions: string | null; isActive: boolean } }) {
  const [state, action, pending] = useActionState(saveBankAccountAction.bind(null, id), init);
  const [delPending, startDel] = useTransition();
  const fe = state.fieldErrors ?? {};
  return (
    <form key={!id && state.ok ? "done" : "form"} action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank name" htmlFor={`bn-${id ?? "new"}`} error={fe.bankName}><Input id={`bn-${id ?? "new"}`} name="bankName" defaultValue={initial?.bankName} required /></Field>
        <Field label="Account name" htmlFor={`an-${id ?? "new"}`} error={fe.accountName}><Input id={`an-${id ?? "new"}`} name="accountName" defaultValue={initial?.accountName} required /></Field>
        <Field label="Account number" htmlFor={`ac-${id ?? "new"}`} error={fe.accountNumber}><Input id={`ac-${id ?? "new"}`} name="accountNumber" inputMode="numeric" defaultValue={initial?.accountNumber} required /></Field>
        <Field label="Currency" htmlFor={`cu-${id ?? "new"}`} error={fe.currency} hint="Clients are shown this account only for payments in this currency."><Input id={`cu-${id ?? "new"}`} name="currency" maxLength={3} defaultValue={initial?.currency ?? "NGN"} required /></Field>
      </div>
      <Field label="Extra instructions (optional)" htmlFor={`in-${id ?? "new"}`} error={fe.instructions}><Textarea id={`in-${id ?? "new"}`} name="instructions" className="min-h-20" defaultValue={initial?.instructions ?? ""} maxLength={500} /></Field>
      <Checkbox name="isActive" label="Show this account to clients" defaultChecked={initial?.isActive ?? true} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Add bank account"}</Button>
        {id && <Button type="button" variant="ghost" disabled={delPending} onClick={() => { if (confirm("Delete this bank account?")) startDel(async () => { await deleteBankAccountAction(id); }); }}>Delete</Button>}
      </div>
    </form>
  );
}
