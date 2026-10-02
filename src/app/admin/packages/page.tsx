import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listAdminPackages } from "@/lib/services/packages";
import { formatMoney } from "@/lib/utils";
import { StatusButton } from "@/components/admin/status-button";

export const metadata: Metadata = { title: "Packages · Admin" };

const TONE = { ACTIVE: "ok", DRAFT: "neutral", INACTIVE: "gold" } as const;

export default async function AdminPackagesPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const actor = await requireStaffPage("packages.view");
  const packages = await listAdminPackages(actor);
  const canManage = can(actor, "packages.manage");
  const { saved } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Travel packages</h1>
          <p className="mt-1 text-ink-3">Only <strong>Active</strong> packages appear on the public website.</p>
        </div>
        {canManage && <Button asChild><Link href="/admin/packages/new"><Plus className="size-4" />New package</Link></Button>}
      </div>
      {saved && <Alert tone="ok">Package saved.</Alert>}

      <Card className="divide-y divide-line">
        {packages.length === 0 && <p className="p-8 text-center text-ink-3">No packages yet.</p>}
        {packages.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-lg font-semibold">{p.name}</p>
                <Badge tone={TONE[p.status]}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Badge>
                {p.isFeatured && <Badge tone="brand">Featured</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-3">
                {p.country} · /packages/{p.slug} · Order {p.displayOrder} · {formatMoney(p.price, p.currency) ?? "No price set"}
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                {p.status !== "ACTIVE" ? <StatusButton id={p.id} status="ACTIVE" label="Activate" /> : <StatusButton id={p.id} status="INACTIVE" label="Deactivate" />}
                <Button asChild variant="outline" size="sm"><Link href={`/admin/packages/${p.id}`}>Edit</Link></Button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
