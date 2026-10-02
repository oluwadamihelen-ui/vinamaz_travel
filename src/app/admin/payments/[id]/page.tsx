import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelPaymentButton, RefundForm, ReviewTransferForm } from "@/components/admin/payment-actions";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/applications/labels";
import { can } from "@/lib/auth/permissions";
import { requireStaffPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatMinor } from "@/lib/payments/amounts";
import { getAdminPaymentView } from "@/lib/services/payments";

export const metadata: Metadata = { title: "Payment · Admin" };
export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => <div><dt className="text-xs uppercase tracking-wider text-ink-3">{label}</dt><dd className="mt-0.5 font-medium">{children}</dd></div>;

export default async function AdminPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage("payments.view");
  const { id } = await params;
  let v;
  try {
    v = await getAdminPaymentView(actor, id);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const { payment, transactions, application, client, items } = v;
  const canManage = can(actor, "payments.manage");
  const canRefund = can(actor, "payments.refund");
  const awaitingTransfer = payment.method === "BANK_TRANSFER" && ["PENDING", "PROCESSING"].includes(payment.status);
  const refundable = payment.amountMinor - payment.refundedAmountMinor;

  return (
    <div className="space-y-6">
      <Link href="/admin/payments" className="text-sm font-medium text-brand hover:underline">← All payments</Link>
      <header className="rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-ink-3">{payment.reference}</p>
            <h1 className="mt-1 font-display text-4xl font-semibold">{formatMinor(payment.amountMinor, payment.currency)}</h1>
            <p className="mt-1 text-ink-3">{payment.description}</p>
          </div>
          <Badge tone={PAYMENT_STATUS_TONE[payment.status]} className="px-3.5 py-1.5 text-sm">{PAYMENT_STATUS_LABEL[payment.status]}</Badge>
        </div>
      </header>

      {payment.status === "PROCESSING" && payment.method !== "BANK_TRANSFER" && <Alert><strong>Needs review.</strong> {payment.failureReason}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Fact label="Client">{client.name}<span className="block text-sm font-normal text-ink-3">{client.email}</span></Fact>
              <Fact label="Application"><Link className="text-brand hover:underline" href={`/admin/applications/${application.id}?tab=payments`}>{application.applicationNumber}</Link><span className="block text-sm font-normal text-ink-3">{application.packageName}</span></Fact>
              <Fact label="Method">{payment.method ? METHOD_LABEL[payment.method] : "Not chosen"}</Fact>
              <Fact label="Paid">{payment.paidAt ? when(payment.paidAt) : "—"}</Fact>
              <Fact label="Created">{when(payment.createdAt)}</Fact>
              <Fact label="Reviewed by">{v.reviewerName ?? "—"}{payment.reviewedAt ? <span className="block text-sm font-normal text-ink-3">{when(payment.reviewedAt)}</span> : null}</Fact>
            </dl>
            <ul className="mt-5 space-y-1 border-t border-line pt-4 text-sm">
              {items.map((i) => <li key={i.label} className="flex justify-between"><span className="text-ink-3">{i.label}</span><span className="font-medium">{formatMinor(i.amountMinor, payment.currency)}</span></li>)}
              {payment.refundedAmountMinor > 0 && <li className="flex justify-between text-ink-3"><span>Refunded{payment.refundReason ? ` (${payment.refundReason})` : ""}</span><span>{formatMinor(payment.refundedAmountMinor, payment.currency)}</span></li>}
            </ul>
          </Card>

          {payment.method === "BANK_TRANSFER" && (
            <Card className="p-6">
              <h2 className="text-xl font-semibold">Transfer proof</h2>
              {payment.proofFilename ? (
                <div className="mt-3 space-y-1 text-sm">
                  <p><a className="font-medium text-brand hover:underline" href={`/api/payments/${payment.id}/proof`}>{payment.proofFilename}</a> <a className="ml-2 text-xs text-ink-3 underline" href={`/api/payments/${payment.id}/proof?inline=1`} target="_blank" rel="noreferrer">view</a></p>
                  <p className="text-ink-3">Paid from: {payment.senderName ?? "—"} · Transfer date: {payment.transferDate ? payment.transferDate.toLocaleDateString("en-GB") : "—"} · Submitted {payment.proofSubmittedAt ? when(payment.proofSubmittedAt) : "—"}</p>
                  <p className="text-ink-3">Check the narration shows <span className="font-mono">{payment.reference}</span> and the amount received is {formatMinor(payment.amountMinor, payment.currency)}.</p>
                </div>
              ) : <p className="mt-3 text-sm text-ink-3">The client hasn&rsquo;t uploaded a receipt yet.</p>}
              {payment.failureReason && payment.status === "FAILED" && <p className="mt-3 text-sm text-gold"><strong>Last rejection:</strong> {payment.failureReason}</p>}
            </Card>
          )}

          <Card className="p-6">
            <h2 className="text-xl font-semibold">Activity</h2>
            <ol className="mt-4 space-y-3 text-sm">
              {transactions.length === 0 && <li className="text-ink-3">No gateway activity yet.</li>}
              {transactions.map((t) => (
                <li key={t.id} className="border-l-2 border-line pl-3">
                  <p className="font-medium">{t.event.replace(/[:_]/g, " ")} <span className="font-normal text-ink-3">· {METHOD_LABEL[t.provider]}</span>{t.status ? <Badge tone={t.event === "duplicate_success" ? "danger" : "neutral"} className="ml-2">{t.status}</Badge> : null}</p>
                  <p className="text-xs text-ink-3">{when(t.createdAt)}{t.providerReference ? ` · ${t.providerReference}` : ""}{t.amountMinor !== null && t.currency ? ` · ${formatMinor(t.amountMinor, t.currency)}` : ""}</p>
                  {t.note && <p className="text-xs text-gold">{t.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {canManage && awaitingTransfer && <Card className="p-6"><h2 className="mb-4 text-xl font-semibold">Confirm bank transfer</h2><ReviewTransferForm paymentId={payment.id} /></Card>}
          {canManage && payment.kind === "ADDITIONAL" && ["PENDING", "FAILED"].includes(payment.status) && <Card className="p-6"><h2 className="mb-3 text-xl font-semibold">Cancel this request</h2><CancelPaymentButton paymentId={payment.id} applicationId={application.id} /></Card>}
          {payment.status === "SUCCESS" || payment.status === "PARTIALLY_REFUNDED" ? (
            <>
              <Card className="p-6"><a className="font-semibold text-brand hover:underline" href={`/api/payments/${payment.id}/receipt`}>Download receipt (PDF)</a></Card>
              {canRefund ? <Card className="p-6"><h2 className="mb-4 text-xl font-semibold">Record a refund</h2><RefundForm paymentId={payment.id} currency={payment.currency} remaining={formatMinor(refundable, payment.currency)} /></Card> : <Alert>Refunds can only be recorded by someone with refund permission.</Alert>}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
