import type { Metadata } from "next";
import { CreateStaffForm, EditStaffForm } from "@/components/admin/staff-forms";
import { Badge, Card } from "@/components/ui/misc";
import { requireStaffPage } from "@/lib/auth/session";
import { GRANTABLE_PERMISSIONS, listStaffAccounts } from "@/lib/services/staff";

export const metadata: Metadata = { title: "Staff · Admin" };
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const actor = await requireStaffPage("settings.manage");
  const users = await listStaffAccounts(actor);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Staff</h1>
        <p className="mt-1 text-ink-3">Create team members and choose what each person can do. Staff only see applications assigned to them.</p>
      </div>
      <Card className="p-6"><h2 className="mb-4 text-xl font-semibold">Invite a team member</h2><CreateStaffForm permissions={GRANTABLE_PERMISSIONS} /></Card>
      <div className="space-y-4">
        {users.map((u) => (
          <Card key={u.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">{u.name}</p>
                <p className="text-sm text-ink-3">{u.email} · {u._count.assignedApplications} assigned · {u.lastLoginAt ? `last sign-in ${u.lastLoginAt.toLocaleDateString("en-GB")}` : "never signed in"}</p>
              </div>
              <div className="flex gap-2"><Badge tone={u.role === "SUPER_ADMIN" ? "brand" : "neutral"}>{u.role.toLowerCase().replace("_", " ")}</Badge>{!u.isActive && <Badge tone="danger">Inactive</Badge>}</div>
            </div>
            {u.role === "SUPER_ADMIN" ? (
              <p className="mt-3 text-sm text-ink-3">Full access. Managed outside this screen.</p>
            ) : (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-brand">Edit permissions &amp; access</summary>
                <div className="mt-3"><EditStaffForm userId={u.id} permissions={GRANTABLE_PERMISSIONS} selected={u.permissions} isActive={u.isActive} role={u.role} /></div>
              </details>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
