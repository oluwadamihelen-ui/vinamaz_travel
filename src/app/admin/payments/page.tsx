import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/applications/labels";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMinor } from "@/lib/payments/amounts";
import { listAdminPayments } from "@/lib/services/payments";
import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Payments · Admin" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const STATUSES = Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[];
const METHODS = Object.keys(METHOD_LABEL) as PaymentMethod[];
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireStaffPage("payments.view");
  const sp = await searchParams;
  const status = one(sp.status) as PaymentStatus | undefined;
  const method = one(sp.method) as PaymentMethod | undefined;
  const filters = { q: one(sp.q), from: one(sp.from), to: one(sp.to), status: status && STATUSES.includes(status) ? status : undefined, method: method && METHODS.includes(method) ? method : undefined, page: Number(one(sp.page)) || 1 };
  const list = await listAdminPayments(actor, filters);
  const qs = (page: number) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q: filters.q, status: filters.status, method: filters.method, from: filters.from, to: filters.to })) if (v) p.set(k, v); p.set("page", String(page)); return `/admin/payments?${p}`; };
  const hasFilters = Boolean(filters.q || filters.status || filters.method || filters.from || filters.to);
  const awaiting = list.items.filter((i) => i.status === "PROCESSING").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="mt-1 text-ink-3">{list.total} {list.total === 1 ? "payment" : "payments"}{hasFilters ? " match your filters" : ""}.{awaiting > 0 && <span className="ml-2 font-medium text-gold">{awaiting} on this page awaiting confirmation.</span>}</p>
      </div>
      <Card className="p-4 sm:p-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <Input name="q" defaultValue={filters.q} placeholder="Reference, application ID, name or email" aria-label="Search" className="sm:col-span-2" />
          <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>)}</Select>
          <Select name="method" defaultValue={filters.method ?? ""} aria-label="Method"><option value="">All methods</option>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
          <Input name="from" type="date" defaultValue={filters.from} aria-label="From" />
          <Input name="to" type="date" defaultValue={filters.to} aria-label="To" />
          <div className="flex gap-2 sm:col-span-2"><Button type="submit">Apply filters</Button>{hasFilters && <Button asChild variant="ghost"><Link href="/admin/payments">Clear</Link></Button>}</div>
        </form>
      </Card>

      {list.items.length === 0 ? <Card className="p-10 text-center text-ink-3">No payments found.</Card> : (
        <>
          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper text-xs uppercase tracking-wider text-ink-3"><tr>{["Reference", "Client", "Application", "Amount", "Method", "Status", "Date"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {list.items.map((p) => (
                  <tr key={p.id} className="hover:bg-paper/60">
                    <td className="px-4 py-3 font-mono text-xs"><Link className="font-medium text-brand hover:underline" href={`/admin/payments/${p.id}`}>{p.reference}</Link>{p.kind === "ADDITIONAL" && <Badge tone="gold" className="ml-2">Extra</Badge>}</td>
                    <td className="px-4 py-3"><p className="font-medium">{p.client.name}</p><p className="text-xs text-ink-3">{p.client.email}</p></td>
                    <td className="px-4 py-3"><Link className="text-brand hover:underline" href={`/admin/applications/${p.application.id}?tab=payments`}>{p.application.applicationNumber}</Link><p className="text-xs text-ink-3">{p.application.packageName}</p></td>
                    <td className="px-4 py-3 font-semibold">{formatMinor(p.amountMinor, p.currency)}</td>
                    <td className="px-4 py-3">{p.method ? METHOD_LABEL[p.method] : <span className="text-ink-3">—</span>}</td>
                    <td className="px-4 py-3"><Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge></td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-3">{fmt(p.paidAt ?? p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="grid gap-3 lg:hidden">
            {list.items.map((p) => (
              <Link key={p.id} href={`/admin/payments/${p.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3"><p className="font-mono text-xs font-medium text-brand">{p.reference}</p><Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge></div>
                <p className="mt-1 font-semibold">{formatMinor(p.amountMinor, p.currency)} <span className="text-sm font-normal text-ink-3">· {p.method ? METHOD_LABEL[p.method] : "no method yet"}</span></p>
                <p className="text-sm text-ink-3">{p.client.name} · {p.application.applicationNumber} · {fmt(p.paidAt ?? p.createdAt)}</p>
              </Link>
            ))}
          </div>
          <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
            <span className="text-ink-3">Page {list.page} of {list.pages}</span>
            <div className="flex gap-2">{list.page > 1 && <Button asChild variant="outline" size="sm"><Link href={qs(list.page - 1)}>Previous</Link></Button>}{list.page < list.pages && <Button asChild variant="outline" size="sm"><Link href={qs(list.page + 1)}>Next</Link></Button>}</div>
          </nav>
        </>
      )}
    </div>
  );
}
