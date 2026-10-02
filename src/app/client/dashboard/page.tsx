import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationCard } from "@/components/apply/application-card";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/misc";
import { requireClientPage } from "@/lib/auth/session";
import { getClientDashboard } from "@/lib/services/applications";

export const metadata: Metadata = { title: "My dashboard" };
export const dynamic = "force-dynamic";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "gold" }) {
  return (
    <Card className={`p-5 ${tone === "gold" && value > 0 ? "border-gold-bright/60 bg-gold-soft/40" : ""}`}>
      <p className="font-display text-4xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-ink-3">{label}</p>
    </Card>
  );
}

export default async function ClientDashboardPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const actor = await requireClientPage();
  const [dash, sp] = await Promise.all([getClientDashboard(actor), searchParams]);
  const others = dash.items.filter((i) => i.id !== dash.current?.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold sm:text-4xl">Hello, {actor.name.split(" ")[0]}</h1>
        <p className="mt-1 text-ink-3">Here&rsquo;s what&rsquo;s happening with your applications.</p>
      </div>
      {sp.saved && <Alert tone="ok">Your progress has been saved. You can continue any time.</Alert>}

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active applications" value={dash.counts.active} />
        <Stat label="Documents required" value={dash.counts.documentsRequired} tone="gold" />
        <Stat label="Pending payments" value={dash.counts.pendingPayments} tone="gold" />
        <Stat label="Completed applications" value={dash.counts.completed} />
      </section>

      {dash.current ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Current application</h2>
          <ApplicationCard app={dash.current} highlight />
          {dash.current.documentsToReplace.length > 0 && (
            <Card className="p-5">
              <p className="font-semibold">Documents that need your attention</p>
              <ul className="mt-3 space-y-3 text-sm">
                {dash.current.documentsToReplace.map((d) => (
                  <li key={d.id} className="rounded-xl bg-paper p-3">
                    <p className="font-medium">{d.name} <span className="text-gold">· Replacement required</span></p>
                    {d.rejectionReason && <p className="mt-1 text-ink-3"><strong>Reason:</strong> {d.rejectionReason}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      ) : dash.items.length === 0 ? (
        <Card className="p-7">
          <h2 className="text-xl font-semibold">Start an application</h2>
          <p className="mt-2 max-w-xl text-[15px] text-ink-3">Choose a travel package to begin. Your applications, documents and payments will appear here once you start.</p>
          <Button asChild className="mt-5"><Link href="/packages">Browse travel packages</Link></Button>
        </Card>
      ) : null}

      {others.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{dash.current ? "Other applications" : "Your applications"}</h2>
          <div className="grid gap-4 lg:grid-cols-2">{others.map((a) => <ApplicationCard key={a.id} app={a} />)}</div>
        </section>
      )}
      {dash.items.length > 0 && <Button asChild variant="outline"><Link href="/packages">Start another application</Link></Button>}
    </div>
  );
}
