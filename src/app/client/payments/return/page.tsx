import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { AutoRefresh } from "@/components/payments/auto-refresh";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { requireClientPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { verifyPaymentReturn } from "@/lib/services/payments";

export const metadata: Metadata = { title: "Payment status" };
export const dynamic = "force-dynamic";

/**
 * Where gateways send the customer back. Whatever status flags the gateway puts in the URL are
 * IGNORED: we only read our own payment reference and ask the gateway's API what really happened.
 */
export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const actor = await requireClientPage();
  const reference = (await searchParams).payment ?? "";
  let result;
  try {
    result = await verifyPaymentReturn(actor, reference);
  } catch (e) {
    if (e instanceof AppError) return (
      <Card className="mx-auto max-w-lg p-8 text-center"><p className="text-lg font-semibold">We couldn&rsquo;t find that payment.</p><Button asChild className="mt-5"><Link href="/client/payments">View my payments</Link></Button></Card>
    );
    throw e;
  }
  const paid = ["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"].includes(result.status);
  const failed = result.status === "FAILED";
  return (
    <Card className="mx-auto max-w-lg p-8 text-center">
      {paid ? <CheckCircle2 className="mx-auto size-14 text-ok" /> : failed ? <XCircle className="mx-auto size-14 text-danger" /> : <Clock className="mx-auto size-14 text-gold" />}
      <h1 className="mt-4 text-3xl font-semibold">{paid ? "Payment successful" : failed ? "Payment not completed" : "Confirming your payment…"}</h1>
      <p className="mt-2 text-ink-3">
        {paid ? <>Reference <span className="font-mono">{result.reference}</span></> : failed ? "Your payment didn't go through and you haven't been charged. You can try again." : result.outcome === "unverified" ? "We couldn't verify this payment yet. Please wait while we confirm the transaction." : "We're waiting for the payment provider to confirm. This usually takes a few seconds."}
      </p>
      {!paid && !failed && <AutoRefresh />}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {paid ? (
          <>
            <Button asChild><Link href={`/client/payments/${result.paymentId}`}>View application payment</Link></Button>
            <Button asChild variant="outline"><a href={`/api/payments/${result.paymentId}/receipt`}>Download receipt</a></Button>
          </>
        ) : (
          <Button asChild variant={failed ? "primary" : "outline"}><Link href={`/client/payments/${result.paymentId}`}>{failed ? "Try again" : "View payment"}</Link></Button>
        )}
      </div>
    </Card>
  );
}
