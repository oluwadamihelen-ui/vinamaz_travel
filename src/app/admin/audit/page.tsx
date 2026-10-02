import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/misc";
import { requireStaffPage } from "@/lib/auth/session";
import { listAuditLog } from "@/lib/services/audit";

export const metadata: Metadata = { title: "Audit log · Admin" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireStaffPage("audit.view");
  const sp = await searchParams;
  const f = { q: one(sp.q), action: one(sp.action), entityType: one(sp.entityType), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page)) || 1 };
  const log = await listAuditLog(actor, f);
  const qs = (page: number) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q: f.q, action: f.action, entityType: f.entityType, from: f.from, to: f.to })) if (v) p.set(k, v); p.set("page", String(page)); return `/admin/audit?${p}`; };
  const hasFilters = Boolean(f.q || f.action || f.entityType || f.from || f.to);

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-semibold">Audit log</h1><p className="mt-1 text-ink-3">{log.total} recorded {log.total === 1 ? "event" : "events"}{hasFilters ? " match your filters" : ""}. Entries can&rsquo;t be edited or deleted from here.</p></div>
      <Card className="p-4 sm:p-5">
        <form method="get" role="search" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input name="q" defaultValue={f.q} placeholder="Person, action or record ID" aria-label="Search" className="sm:col-span-2" />
          <Select name="action" defaultValue={f.action ?? ""} aria-label="Action"><option value="">All actions</option>{log.actions.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
          <Select name="entityType" defaultValue={f.entityType ?? ""} aria-label="Record type"><option value="">All record types</option>{log.entityTypes.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
          <Input name="from" type="date" defaultValue={f.from} aria-label="From" />
          <Input name="to" type="date" defaultValue={f.to} aria-label="To" />
          <div className="flex gap-2 sm:col-span-2"><Button type="submit">Apply filters</Button>{hasFilters && <Button asChild variant="ghost"><Link href="/admin/audit">Clear</Link></Button>}</div>
        </form>
      </Card>

      {log.rows.length === 0 ? <Card className="p-10 text-center text-ink-3">No events found.</Card> : (
        <Card className="divide-y divide-line">
          {log.rows.map((r) => (
            <details key={r.id} className="group p-4">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                <span className="min-w-0"><span className="font-mono text-sm font-semibold">{r.action}</span><span className="ml-3 text-sm text-ink-3">{r.actor ? `${r.actor.name} (${r.actor.role.toLowerCase().replace("_", " ")})` : "System"}</span></span>
                <span className="text-xs text-ink-3">{when(r.createdAt)}</span>
              </summary>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-xs uppercase tracking-wider text-ink-3">Record</dt><dd className="font-mono text-xs">{r.entityType}{r.entityId ? ` · ${r.entityId}` : ""}</dd></div>
                {r.actor && <div><dt className="text-xs uppercase tracking-wider text-ink-3">Email</dt><dd>{r.actor.email}</dd></div>}
                {r.metadata && <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wider text-ink-3">Details</dt><dd><pre className="mt-1 overflow-x-auto rounded-xl bg-paper p-3 text-xs">{JSON.stringify(r.metadata, null, 2)}</pre></dd></div>}
              </dl>
            </details>
          ))}
        </Card>
      )}

      {log.pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          {log.page > 1 ? <Link className="font-medium text-brand hover:underline" href={qs(log.page - 1)}>← Newer</Link> : <span />}
          <span className="text-ink-3">Page {log.page} of {log.pages}</span>
          {log.page < log.pages ? <Link className="font-medium text-brand hover:underline" href={qs(log.page + 1)}>Older →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
