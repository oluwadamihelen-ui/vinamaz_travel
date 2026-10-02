import type { Metadata } from "next";
import { ApplicationCard } from "@/components/apply/application-card";
import { requireClientPage } from "@/lib/auth/session";
import { getClientDashboard } from "@/lib/services/applications";
import { Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata: Metadata = { title: "My applications" };
export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const actor = await requireClientPage();
  const { items } = await getClientDashboard(actor);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">My applications</h1>
      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-ink-3">You haven&rsquo;t started an application yet.</p>
          <Button asChild className="mt-4"><Link href="/packages">Browse travel packages</Link></Button>
        </Card>
      ) : (
        <div className="grid gap-4">{items.map((a) => <ApplicationCard key={a.id} app={a} />)}</div>
      )}
    </div>
  );
}
