"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banknote, CheckCircle2, Copy, CreditCard, Download, Landmark, Lock } from "lucide-react";
import { UploadError, uploadFile } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { chooseBankTransferAction, payOnlineAction } from "@/lib/actions/payments";
import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";
import { METHOD_LABEL } from "@/lib/applications/labels";

export interface BankView { id: string; bankName: string; accountName: string; accountNumber: string; instructions: string | null }
interface Props {
  paymentId: string;
  reference: string;
  amountLabel: string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  failureReason: string | null;
  methods: { method: PaymentMethod; label: string }[];
  banks: BankView[];
  proof: { filename: string; senderName: string | null; submittedAt: string } | null;
}

const OPEN: PaymentStatus[] = ["PENDING", "FAILED", "CANCELLED"];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}
      className="inline-flex size-10 items-center justify-center rounded-full text-ink-3 hover:bg-sand hover:text-ink">
      {done ? <CheckCircle2 className="size-4 text-ok" /> : <Copy className="size-4" />}
    </button>
  );
}

export function PaymentPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [sender, setSender] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const isOpen = OPEN.includes(p.status);
  const bankMode = p.method === "BANK_TRANSFER" && (isOpen || p.status === "PROCESSING");

  const payOnline = (method: PaymentMethod) =>
    start(async () => {
      setError(null);
      const res = await payOnlineAction(p.paymentId, method);
      if (res.error) setError(res.error);
      else if (res.redirectTo) window.location.assign(res.redirectTo);
    });

  const chooseBank = () =>
    start(async () => {
      setError(null);
      const res = await chooseBankTransferAction(p.paymentId);
      if (res.error) setError(res.error);
      else router.refresh();
    });

  async function uploadProof(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFields({});
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Please choose your transfer receipt (PDF, JPG or PNG).");
    if (file.size > 10 * 1024 * 1024) return setError("That file is too large. The maximum size is 10MB.");
    const senderName = String(form.get("senderName") ?? "").trim();
    const transferDate = String(form.get("transferDate") ?? "");
    if (senderName.length < 2) return setFields({ senderName: ["Enter the name on the account you paid from"] });
    if (!transferDate) return setFields({ transferDate: ["Enter the date you made the transfer"] });
    setUploading(true);
    try {
      await uploadFile({ kind: "PAYMENT_PROOF", paymentId: p.paymentId, file, extra: { senderName, transferDate } });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your upload failed. Please try again.");
      if (err instanceof UploadError && err.fieldErrors) setFields(err.fieldErrors);
    } finally {
      setUploading(false);
    }
  }

  if (p.status === "SUCCESS" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-6 text-ok" /><div><p className="text-lg font-semibold">Payment received</p><p className="text-sm text-ink-3">Reference {p.reference}</p></div></div>
        <Button asChild className="mt-5"><a href={`/api/payments/${p.paymentId}/receipt`}><Download className="size-4" />Download receipt</a></Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {error && <Alert>{error}</Alert>}
      {p.failureReason && isOpen && p.status === "FAILED" && <Alert><strong>Payment not completed.</strong> {p.failureReason}</Alert>}

      {bankMode && (
        <Card className="p-6">
          <div className="flex items-center gap-2"><Landmark className="size-5 text-brand" /><h2 className="text-xl font-semibold">Pay by bank transfer</h2></div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-3">
            <li>Transfer exactly <strong className="text-ink">{p.amountLabel}</strong> to the account below.</li>
            <li>Use <strong className="text-ink">{p.reference}</strong> as the transfer narration/description so we can match it.</li>
            <li>Upload your transfer receipt. We&rsquo;ll confirm it, usually within one business day.</li>
          </ol>
          <div className="mt-4 space-y-3">
            {p.banks.map((b) => (
              <div key={b.id} className="rounded-2xl border border-line bg-paper p-4 text-sm">
                <p className="font-semibold">{b.bankName}</p>
                <dl className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2"><dt className="text-ink-3">Account name</dt><dd className="font-medium">{b.accountName}</dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-ink-3">Account number</dt><dd className="flex items-center font-mono text-base font-semibold tracking-wider">{b.accountNumber}<CopyButton value={b.accountNumber} label="account number" /></dd></div>
                  <div className="flex items-center justify-between gap-2"><dt className="text-ink-3">Narration</dt><dd className="flex items-center font-mono font-medium">{p.reference}<CopyButton value={p.reference} label="reference" /></dd></div>
                </dl>
                {b.instructions && <p className="mt-2 text-xs text-ink-3">{b.instructions}</p>}
              </div>
            ))}
          </div>

          {p.status === "PROCESSING" && p.proof && (
            <div className="mt-4"><Alert tone="ok"><strong>Receipt submitted.</strong> We&rsquo;re checking your transfer ({p.proof.filename}{p.proof.senderName ? `, from ${p.proof.senderName}` : ""}). You&rsquo;ll be notified once it&rsquo;s confirmed. You can upload a different receipt below if needed.</Alert></div>
          )}

          <form onSubmit={uploadProof} className="mt-5 space-y-4 border-t border-line pt-5">
            <p className="font-semibold">{p.status === "PROCESSING" ? "Replace your receipt" : "Upload your transfer receipt"}</p>
            <Field label="Name on the account you paid from" htmlFor="senderName" error={fields.senderName}><Input id="senderName" name="senderName" required value={sender} onChange={(e) => setSender(e.target.value)} /></Field>
            <Field label="Date of transfer" htmlFor="transferDate" error={fields.transferDate}><Input id="transferDate" name="transferDate" type="date" required value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Transfer receipt (PDF, JPG or PNG, max 10MB)" htmlFor="file"><input id="file" name="file" type="file" required accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm file:mr-4 file:h-11 file:rounded-full file:border-0 file:bg-ink file:px-5 file:text-sm file:font-medium file:text-white" /></Field>
            <Button type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Submit receipt"}</Button>
          </form>
        </Card>
      )}

      {isOpen && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold">{bankMode ? "Prefer to pay online instead?" : "Choose how to pay"}</h2>
          {!bankMode && <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3"><Lock className="size-4" aria-hidden />You&rsquo;ll be taken to the provider&rsquo;s secure checkout. Vinamaz never sees your card details.</p>}
          {p.methods.length === 0 && <p className="mt-4 text-sm text-ink-3">No payment methods are available right now. Please contact Vinamaz.</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {p.methods.filter((m) => m.method !== "BANK_TRANSFER").map((m) => (
              <button key={m.method} type="button" disabled={pending} onClick={() => payOnline(m.method)}
                className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-white p-4 text-left font-medium transition hover:border-brand hover:shadow-card disabled:opacity-60">
                <CreditCard className="size-5 text-brand" /><span>Pay {p.amountLabel}<span className="block text-xs font-normal text-ink-3">with {m.label} (card, bank, USSD)</span></span>
              </button>
            ))}
            {!bankMode && p.methods.some((m) => m.method === "BANK_TRANSFER") && (
              <button type="button" disabled={pending} onClick={chooseBank}
                className="flex min-h-16 items-center gap-3 rounded-2xl border border-line bg-white p-4 text-left font-medium transition hover:border-brand hover:shadow-card disabled:opacity-60">
                <Banknote className="size-5 text-brand" /><span>Bank transfer<span className="block text-xs font-normal text-ink-3">Transfer manually and upload your receipt</span></span>
              </button>
            )}
          </div>
          {pending && <p className="mt-3 text-sm text-ink-3">One moment…</p>}
        </Card>
      )}

      {p.status === "PROCESSING" && p.method !== "BANK_TRANSFER" && (
        <Alert><strong>We&rsquo;re reviewing this payment.</strong> The amount received needs a quick check by our team. We&rsquo;ll update you shortly.</Alert>
      )}
      <p className="text-xs text-ink-3">Payment method: {p.method ? METHOD_LABEL[p.method] : "not chosen yet"} · Reference {p.reference}</p>
    </div>
  );
}
