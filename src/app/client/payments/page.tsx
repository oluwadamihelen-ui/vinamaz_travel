import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/misc";
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/applications/labels";
import { requireClientPage } from "@/lib/auth/session";
import { formatMinor } from "@/lib/payments/amounts";
import { listClientPayments } from "@/lib/services/payments";

export const metadata: Metadata = { title: "My payments" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireClientPage();
  const page = Number((await searchParams).page) || 1;
  const { items, pages } = await listClientPayments(actor, { page });
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">My payments</h1>
      {items.length === 0 ? (
        <Card className="p-8 text-center text-ink-3">You haven&rsquo;t made any payments yet.</Card>
      ) : (
        <div className="grid gap-3">
          {items.map((p) => {
            const paid = ["SUCCESS", "REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status);
            const open = ["PENDING", "FAILED", "PROCESSING"].includes(p.status);
            return (
              <Card key={p.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.description}</p>
                    <p className="text-sm text-ink-3">{p.application.packageName} · {p.application.applicationNumber}</p>
                    <p className="mt-1 text-xs text-ink-3">Ref <span className="font-mono">{p.reference}</span> · {fmt(p.paidAt ?? p.createdAt)}{p.method ? ` · ${METHOD_LABEL[p.method]}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-2xl font-semibold">{formatMinor(p.amountMinor, p.currency)}</p>
                    <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {paid && <Button asChild size="sm" variant="outline"><a href={`/api/payments/${p.id}/receipt`}><Download className="size-4" />Receipt</a></Button>}
                  <Button asChild size="sm" variant={open && p.status !== "PROCESSING" ? "primary" : "ghost"}><Link href={`/client/payments/${p.id}`}>{open && p.status !== "PROCESSING" ? "Pay now" : "View details"}</Link></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {pages > 1 && (
        <nav className="flex gap-2 text-sm" aria-label="Pagination">
          {page > 1 && <Button asChild variant="outline" size="sm"><Link href={`/client/payments?page=${page - 1}`}>Previous</Link></Button>}
          {page < pages && <Button asChild variant="outline" size="sm"><Link href={`/client/payments?page=${page + 1}`}>Next</Link></Button>}
        </nav>
      )}
    </div>
  );
}
