"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import {
  cancelPaymentAction, recheckPaymentAction, refundAction, requestExtraPaymentAction, resolveHeldAction, reviewTransferAction, type PayState,
} from "@/lib/actions/payments";

const init: PayState = {};
const Feedback = ({ s }: { s: PayState }) => (s.error ? <Alert>{s.error}</Alert> : s.ok && s.message ? <Alert tone="ok">{s.message}</Alert> : null);

export function ReviewTransferForm({ paymentId }: { paymentId: string }) {
  const [reject, setReject] = useState(false);
  const [cState, confirm, cPending] = useActionState(reviewTransferAction.bind(null, paymentId, "confirm"), init);
  const [rState, rejectAction, rPending] = useActionState(reviewTransferAction.bind(null, paymentId, "reject"), init);
  const state = rState.error || rState.ok ? rState : cState;
  return (
    <div className="space-y-3">
      <Feedback s={state} />
      <form action={confirm} className="space-y-3">
        <Field label="Note (optional)" htmlFor="confirm-note" hint="Internal. For example the bank statement line you matched."><Input id="confirm-note" name="note" maxLength={500} /></Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={cPending || rPending}>{cPending ? "Confirming…" : "Confirm payment received"}</Button>
          <Button type="button" variant="outline" onClick={() => setReject((v) => !v)}>Reject transfer</Button>
        </div>
      </form>
      {reject && (
        <form action={rejectAction} className="space-y-2 rounded-xl border border-line bg-paper p-3">
          <Field label="Reason (the client will see this)" htmlFor="reject-note" error={rState.fieldErrors?.note}><Input id="reject-note" name="note" required maxLength={500} /></Field>
          <Button type="submit" size="sm" disabled={rPending}>{rPending ? "Rejecting…" : "Reject and ask client to resubmit"}</Button>
        </form>
      )}
    </div>
  );
}

export function ResolveHeldForm({ paymentId }: { paymentId: string }) {
  const [aState, approve, aPending] = useActionState(resolveHeldAction.bind(null, paymentId, "approve"), init);
  const [rState, reject, rPending] = useActionState(resolveHeldAction.bind(null, paymentId, "reject"), init);
  const state = rState.error || rState.ok ? rState : aState;
  return (
    <form className="space-y-3">
      <Feedback s={state} />
      <Field label="Reason for your decision (kept in the audit log)" htmlFor="held-note" error={state.fieldErrors?.note}><Textarea id="held-note" name="note" className="min-h-20" required maxLength={500} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" formAction={approve} disabled={aPending || rPending}>{aPending ? "Accepting…" : "Accept as paid"}</Button>
        <Button type="submit" variant="danger" formAction={reject} disabled={aPending || rPending}>{rPending ? "Rejecting…" : "Reject (refund the customer)"}</Button>
      </div>
    </form>
  );
}

export function RecheckButton({ paymentId }: { paymentId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<PayState>({});
  return (
    <div className="space-y-2">
      <Feedback s={state} />
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => start(async () => setState(await recheckPaymentAction(paymentId)))}>{pending ? "Asking the gateway…" : "Re-check with gateway"}</Button>
    </div>
  );
}

export function RefundForm({ paymentId, currency, remaining, viaGateway }: { paymentId: string; currency: string; remaining: string; viaGateway?: string | null }) {
  const [state, action, pending] = useActionState(refundAction.bind(null, paymentId), init);
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-3">
      <Feedback s={state} />
      <p className="text-sm text-ink-3">{viaGateway ? <>This refunds through <strong>{viaGateway}</strong> and records it here.</> : <>This <strong>records</strong> a refund. Send the money from your bank first.</>} Refundable: {remaining}.</p>
      <Field label={`Amount (${currency})`} htmlFor="refund-amount" error={state.fieldErrors?.amount}><Input id="refund-amount" name="amount" inputMode="decimal" required /></Field>
      <Field label="Reason" htmlFor="refund-reason" error={state.fieldErrors?.reason}><Textarea id="refund-reason" name="reason" className="min-h-20" required maxLength={500} /></Field>
      <Button type="submit" variant="danger" disabled={pending}>{pending ? "Working…" : viaGateway ? "Refund through gateway" : "Record refund"}</Button>
    </form>
  );
}

export function RequestPaymentForm({ applicationId, currency }: { applicationId: string; currency: string }) {
  const [state, action, pending] = useActionState(requestExtraPaymentAction.bind(null, applicationId), init);
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-3">
      <Feedback s={state} />
      <Field label="What is it for?" htmlFor="extra-label" error={state.fieldErrors?.label}><Input id="extra-label" name="label" placeholder="e.g. Courier fee" required maxLength={120} /></Field>
      <Field label={`Amount (${currency})`} htmlFor="extra-amount" error={state.fieldErrors?.amount}><Input id="extra-amount" name="amount" inputMode="decimal" required /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Requesting…" : "Request payment"}</Button>
    </form>
  );
}

export function CancelPaymentButton({ paymentId, applicationId }: { paymentId: string; applicationId: string }) {
  const [state, action, pending] = useActionState(cancelPaymentAction.bind(null, paymentId, applicationId), init);
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <Feedback s={state} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>{pending ? "…" : "Cancel request"}</Button>
    </form>
  );
}
