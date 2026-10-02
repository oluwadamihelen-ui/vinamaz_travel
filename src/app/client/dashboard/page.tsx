import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { requireClientPage } from "@/lib/auth/session";
import { getClientProfile } from "@/lib/services/users";
import { listClientApplications } from "@/lib/services/applications";
import { ApplicationCard } from "@/components/apply/application-card";
import { Alert } from "@/components/ui/misc";

export const metadata: Metadata = { title: "My dashboard" };

/** Phase 1 shell: account + profile only. Applications, payments and messages arrive in later phases. */
export default async function ClientDashboardPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const actor = await requireClientPage();
  const [profile, { items }, sp] = await Promise.all([getClientProfile(actor, actor.id), listClientApplications(actor, { take: 10 }), searchParams]);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Hello, {actor.name.split(" ")[0]}</h1>
        <p className="mt-1 text-ink-3">Welcome to your Vinamaz client portal.</p>
      </div>
      {sp.saved && <Alert tone="ok">Your progress has been saved. You can continue any time.</Alert>}
      {items.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Your applications</h2>
          <div className="grid gap-4">{items.map((a) => <ApplicationCard key={a.id} app={a} />)}</div>
          <Button asChild variant="outline"><Link href="/packages">Start another application</Link></Button>
        </section>
      ) : (
        <Card className="p-7">
          <h2 className="text-xl font-semibold">Start an application</h2>
          <p className="mt-2 max-w-xl text-[15px] text-ink-3">Choose a travel package to begin. Your applications, documents and payments will appear here once you start.</p>
          <Button asChild className="mt-5"><Link href="/packages">Browse travel packages</Link></Button>
        </Card>
      )}
      <Card className="p-7">
        <h2 className="text-xl font-semibold">Your details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-3">Email</dt><dd className="font-medium">{profile.user.email}</dd></div>
          <div><dt className="text-ink-3">Phone</dt><dd className="font-medium">{profile.user.phone ?? "—"}</dd></div>
          <div><dt className="text-ink-3">Country of residence</dt><dd className="font-medium">{profile.countryOfResidence}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
