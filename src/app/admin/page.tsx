import { redirect } from "next/navigation";
import Link from "next/link";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { Alert } from "@/components/ui/misc";

/** Phase 1: the admin dashboard proper arrives in Phase 5; route staff to what exists. */
export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const actor = await requireStaffPage();
  const { denied } = await searchParams;
  if (!denied && can(actor, "packages.view")) redirect("/admin/packages");
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-3xl font-semibold">Staff portal</h1>
      {denied && <Alert>You don&rsquo;t have permission to open that page.</Alert>}
      <p className="text-ink-3">Your account has no administrative areas enabled yet. Ask an administrator to grant you access.</p>
      {can(actor, "packages.view") && <Link className="font-semibold text-brand" href="/admin/packages">Go to packages</Link>}
    </div>
  );
}
