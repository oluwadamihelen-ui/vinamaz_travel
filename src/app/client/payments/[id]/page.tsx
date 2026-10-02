import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentPanel } from "@/components/payments/payment-panel";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/applications/labels";
import { requireClientPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatMinor } from "@/lib/payments/amounts";
import { getClientPaymentView } from "@/lib/services/payments";

export const metadata: Metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const actor = await requireClientPage();
  const { id } = await params;
  let v;
  try {
    v = await getClientPaymentView(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { payment, application, methods, banks, items } = v;
  const submitted = (await searchParams).submitted === "1";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {submitted && <Alert tone="ok"><strong>Application submitted.</strong> One more step: complete your payment so we can start processing it.</Alert>}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{application.packageCountry} · {application.applicationNumber}</p>
        <h1 className="mt-1 text-3xl font-semibold">Payment</h1>
        <p className="mt-1 text-sm text-ink-3"><Link href={`/client/applications/${application.id}`} className="font-medium text-brand hover:underline">{application.packageName}</Link></p>
      </div>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm text-ink-3">{payment.description}</p><p className="mt-1 font-display text-4xl font-semibold">{formatMinor(payment.amountMinor, payment.currency)}</p></div>
          <Badge tone={PAYMENT_STATUS_TONE[payment.status]} className="px-3 py-1.5 text-sm">{PAYMENT_STATUS_LABEL[payment.status]}</Badge>
        </div>
        <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
          {items.map((i) => <div key={i.label} className="flex justify-between gap-4"><dt className="text-ink-3">{i.label}</dt><dd className="font-medium">{formatMinor(i.amountMinor, payment.currency)}</dd></div>)}
          <div className="flex justify-between gap-4 border-t border-line pt-2 text-base"><dt className="font-semibold">Total</dt><dd className="font-semibold">{formatMinor(payment.amountMinor, payment.currency)}</dd></div>
          {payment.refundedAmountMinor > 0 && <div className="flex justify-between gap-4 text-ink-3"><dt>Refunded</dt><dd>{formatMinor(payment.refundedAmountMinor, payment.currency)}</dd></div>}
        </dl>
        <p className="mt-3 text-xs text-ink-3">Invoice reference: <span className="font-mono">{payment.reference}</span></p>
      </Card>

      <PaymentPanel
        paymentId={payment.id} reference={payment.reference} amountLabel={formatMinor(payment.amountMinor, payment.currency)} status={payment.status} method={payment.method}
        failureReason={payment.failureReason} methods={methods} banks={banks.map((b) => ({ id: b.id, bankName: b.bankName, accountName: b.accountName, accountNumber: b.accountNumber, instructions: b.instructions }))}
        proof={payment.proofFilename ? { filename: payment.proofFilename, senderName: payment.senderName, submittedAt: payment.proofSubmittedAt?.toISOString() ?? "" } : null}
      />
      <p className="text-xs text-ink-3">Vinamaz provides visa assistance. Payment is for our services and does not guarantee a visa decision.</p>
    </div>
  );
}
