import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE, STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
import { requireStaffPage } from "@/lib/auth/session";
import { formatMinor } from "@/lib/payments/amounts";
import { getAdminDashboard } from "@/lib/services/admin-dashboard";

export const metadata: Metadata = { title: "Dashboard · Admin" };
export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, hint, href }: { label: string; value: number | string; hint?: string; href?: string }) {
  const body = (
    <Card className="h-full p-5 transition-shadow hover:shadow-lift">
      <p className="text-sm text-ink-3">{label}</p>
      <p className="mt-1 font-display text-4xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requireStaffPage();
  const denied = (await searchParams).denied;
  const d = await getAdminDashboard(actor);
  const nothing = !d.apps && !d.payments && !d.conversations.length && !d.clients && d.action.length === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Welcome back, {actor.name.split(" ")[0]}</h1>
        <p className="mt-1 text-ink-3">{actor.role === "STAFF" ? "Everything here covers the applications assigned to you." : "A live view of applications, payments and client conversations."}</p>
      </div>
      {denied && <Alert>You don&rsquo;t have permission to open that page.</Alert>}
      {nothing && <Alert>Your account has no areas enabled yet. Ask an administrator to grant you access.</Alert>}

      {d.action.length > 0 && (
        <Card className="border-gold-bright/50 bg-gold-soft/40 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><AlertCircle className="size-5 text-gold" aria-hidden />Action required</h2>
          <ul className="mt-3 divide-y divide-gold-bright/30">
            {d.action.map((a) => (
              <li key={a.key}><Link href={a.href} className="flex items-center justify-between gap-3 py-3 hover:text-brand"><span><strong className="mr-2 font-display text-2xl">{a.count}</strong>{a.label}</span><ArrowRight className="size-4 shrink-0" aria-hidden /></Link></li>
            ))}
          </ul>
        </Card>
      )}

      {d.apps && (
        <section aria-labelledby="apps-h">
          <h2 id="apps-h" className="mb-3 text-xl font-semibold">Applications</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Submitted (all time)" value={d.apps.total} hint={`${d.apps.thisMonth} this month`} href="/admin/applications" />
            <Stat label="Awaiting payment" value={d.apps.awaitingPayment} href="/admin/applications?status=PAYMENT_PENDING" />
            <Stat label="In review" value={d.apps.inReview} href="/admin/applications?status=UNDER_REVIEW" />
            <Stat label="Waiting on client" value={d.apps.awaitingClient} href="/admin/applications?status=DOCUMENTS_REQUIRED" />
            <Stat label="Processing" value={d.apps.processing} href="/admin/applications?status=PROCESSING" />
            <Stat label="Approved" value={d.apps.approved} href="/admin/applications?status=APPROVED" />
            <Stat label="Completed" value={d.apps.completed} href="/admin/applications?status=COMPLETED" />
            <Stat label="Refused / cancelled" value={d.apps.refused + d.apps.cancelled} />
          </div>
        </section>
      )}

      {(d.payments || d.clients) && (
        <section aria-labelledby="money-h" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <h2 id="money-h" className="sr-only">Payments and clients</h2>
          {d.payments && d.payments.length === 0 && <Stat label="Payments received" value="None yet" hint="Confirmed payments appear here." href="/admin/payments" />}
          {d.payments?.map((p) => <Stat key={p.currency} label={`Received (${p.currency}, net of refunds)`} value={formatMinor(p.netMinor, p.currency)} hint={`${formatMinor(p.thisMonthMinor, p.currency)} this month · ${p.payments} payment${p.payments === 1 ? "" : "s"}`} href="/admin/payments" />)}
          {d.clients && <Stat label="Clients" value={d.clients.total} hint={`${d.clients.thisMonth} joined this month`} />}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {d.apps && (
          <Card className="p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Recent applications</h2><Link className="text-sm font-medium text-brand hover:underline" href="/admin/applications">View all</Link></div>
            {d.recentApps.length === 0 ? <p className="text-sm text-ink-3">No submitted applications yet.</p> : (
              <ul className="divide-y divide-line">
                {d.recentApps.map((a) => (
                  <li key={a.id}><Link href={`/admin/applications/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-brand">
                    <span><span className="font-medium">{a.client.name}</span><span className="block text-xs text-ink-3">{a.applicationNumber} · {a.packageName} · {day(a.submittedAt)}</span></span>
                    <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {d.payments && (
          <Card className="p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Recent payments</h2><Link className="text-sm font-medium text-brand hover:underline" href="/admin/payments">View all</Link></div>
            {d.recentPayments.length === 0 ? <p className="text-sm text-ink-3">No payments yet.</p> : (
              <ul className="divide-y divide-line">
                {d.recentPayments.map((p) => (
                  <li key={p.id}><Link href={`/admin/payments/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-brand">
                    <span><span className="font-medium">{formatMinor(p.amountMinor, p.currency)}</span><span className="block text-xs text-ink-3">{p.client.name} · {p.application.applicationNumber} · {day(p.createdAt)}</span></span>
                    <Badge tone={PAYMENT_STATUS_TONE[p.status]}>{PAYMENT_STATUS_LABEL[p.status]}</Badge>
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {d.conversations.length > 0 || actor.role !== "CLIENT" ? (
          d.conversations.length > 0 && (
            <Card className="p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Recent client messages</h2><Link className="text-sm font-medium text-brand hover:underline" href="/admin/messages">Inbox</Link></div>
              <ul className="divide-y divide-line">
                {d.conversations.map((c) => (
                  <li key={c.applicationId}><Link href={`/admin/applications/${c.applicationId}?tab=messages`} className="block py-3 hover:text-brand">
                    <span className="flex flex-wrap items-center gap-2 font-medium">{c.clientName}{c.unread > 0 && <Badge tone="brand">{c.unread} new</Badge>}</span>
                    <span className="block truncate text-sm text-ink-3">{c.lastPreview}</span>
                    <span className="block text-xs text-ink-3">{c.applicationNumber} · {when(c.lastMessageAt)}</span>
                  </Link></li>
                ))}
              </ul>
            </Card>
          )
        ) : null}
        {d.packages.length > 0 && (
          <Card className="p-5 sm:p-6">
            <h2 className="mb-3 text-xl font-semibold">Package performance</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-ink-3"><tr>{["Package", "Submitted", "Approved", "Completed", "Refused"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {d.packages.map((p) => <tr key={p.packageId}><th scope="row" className="py-2.5 pr-3 font-medium">{p.name}</th><td className="pr-3">{p.submitted}</td><td className="pr-3">{p.approved}</td><td className="pr-3">{p.completed}</td><td>{p.refused}</td></tr>)}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-3">Counts of real applications only. No outcome is implied: approval is always the authority&rsquo;s decision.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
