import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { CollapsibleFilters } from "@/components/admin/collapsible-filters";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/misc";
import { APPLICATION_STATUSES, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
import { requireStaffPage } from "@/lib/auth/session";
import { getApplicationFilterOptions, listAdminApplications } from "@/lib/services/admin-applications";
import type { ApplicationStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Applications · Admin" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function AdminApplicationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireStaffPage("applications.view");
  const sp = await searchParams;
  const status = one(sp.status);
  const filters = {
    q: one(sp.q), country: one(sp.country), packageId: one(sp.package), assignee: one(sp.assignee), from: one(sp.from), to: one(sp.to),
    status: status && (APPLICATION_STATUSES as string[]).includes(status) ? (status as ApplicationStatus) : undefined,
    page: Number(one(sp.page)) || 1,
  };
  const [list, options] = await Promise.all([listAdminApplications(actor, filters), getApplicationFilterOptions(actor)]);

  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: filters.q, country: filters.country, package: filters.packageId, status: filters.status, assignee: filters.assignee, from: filters.from, to: filters.to })) if (v) p.set(k, v);
    p.set("page", String(page));
    return `/admin/applications?${p.toString()}`;
  };
  const hasFilters = Boolean(filters.q || filters.country || filters.packageId || filters.status || filters.assignee || filters.from || filters.to);
  const canFilterAssignee = options.staff.length > 0 || actor.role === "STAFF";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Applications</h1>
        <p className="mt-1 text-ink-3">{list.total} {list.total === 1 ? "application" : "applications"}{hasFilters ? " match your filters" : ""}{actor.role === "STAFF" ? " assigned to you" : ""}.</p>
      </div>

      <Card className="p-4 sm:p-5">
        <CollapsibleFilters activeCount={[filters.q, filters.country, filters.packageId, filters.status, filters.assignee, filters.from, filters.to].filter(Boolean).length}>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input name="q" defaultValue={filters.q} placeholder="Search name, email, phone or application ID" className="pl-10" aria-label="Search" />
          </div>
          <Select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Select name="country" defaultValue={filters.country ?? ""} aria-label="Country">
            <option value="">All countries</option>
            {options.countries.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select name="package" defaultValue={filters.packageId ?? ""} aria-label="Package">
            <option value="">All packages</option>
            {options.packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {canFilterAssignee && (
            <Select name="assignee" defaultValue={filters.assignee ?? ""} aria-label="Assigned staff">
              <option value="">Anyone</option>
              <option value="me">Assigned to me</option>
              {actor.role !== "STAFF" && <option value="unassigned">Unassigned</option>}
              {options.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Input name="from" type="date" defaultValue={filters.from} aria-label="Created from" />
          <Input name="to" type="date" defaultValue={filters.to} aria-label="Created to" />
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">Apply filters</Button>
            {hasFilters && <Button asChild variant="ghost"><Link href="/admin/applications">Clear</Link></Button>}
          </div>
        </form>
        </CollapsibleFilters>
      </Card>

      {list.items.length === 0 ? (
        <Card className="p-10 text-center text-ink-3">{hasFilters ? "No applications match these filters." : actor.role === "STAFF" ? "No applications are assigned to you yet." : "No applications yet."}</Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-paper text-xs uppercase tracking-wider text-ink-3">
                <tr>{["Application ID", "Client", "Package", "Status", "Payment", "Progress", "Assigned", "Created", "Updated"].map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.items.map((a) => (
                  <tr key={a.id} className="hover:bg-paper/60">
                    <td className="px-4 py-3 font-medium"><Link className="text-brand hover:underline" href={`/admin/applications/${a.id}`}>{a.applicationNumber}</Link></td>
                    <td className="px-4 py-3"><p className="font-medium">{a.client.name}</p><p className="text-xs text-ink-3">{a.client.email}</p></td>
                    <td className="px-4 py-3"><p>{a.packageName}</p><p className="text-xs text-ink-3">{a.packageCountry}</p></td>
                    <td className="px-4 py-3"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></td>
                    <td className="px-4 py-3">{a.payments[0] ? <Badge tone={PAYMENT_STATUS_TONE[a.payments[0].status]}>{PAYMENT_STATUS_LABEL[a.payments[0].status]}</Badge> : <span className="text-ink-3">—</span>}</td>
                    <td className="px-4 py-3"><span className="font-medium">{a.progressPercent}%</span></td>
                    <td className="px-4 py-3">{a.assignedTo?.name ?? <span className="text-ink-3">Unassigned</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-3">{fmt(a.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-3">{fmt(a.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Mobile / tablet cards */}
          <div className="grid gap-3 lg:hidden">
            {list.items.map((a) => (
              <Link key={a.id} href={`/admin/applications/${a.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-brand">{a.applicationNumber}</p><p className="font-medium">{a.client.name}</p></div>
                  <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                </div>
                <p className="mt-2 text-sm text-ink-3">{a.packageName} · {a.packageCountry}</p>
                <p className="mt-1 text-sm text-ink-3">{a.progressPercent}% complete · {a.payments[0] ? PAYMENT_STATUS_LABEL[a.payments[0].status] : "No payment"} · {a.assignedTo?.name ?? "Unassigned"} · Updated {fmt(a.updatedAt)}</p>
              </Link>
            ))}
          </div>
          <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
            <span className="text-ink-3">Page {list.page} of {list.pages}</span>
            <div className="flex gap-2">
              {list.page > 1 && <Button asChild variant="outline" size="sm"><Link href={qs(list.page - 1)}>Previous</Link></Button>}
              {list.page < list.pages && <Button asChild variant="outline" size="sm"><Link href={qs(list.page + 1)}>Next</Link></Button>}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
