import type { Metadata } from "next";
import { PackageForm } from "@/components/admin/package-form";
import { requireStaffPage } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New package · Admin" };

export default async function NewPackagePage() {
  await requireStaffPage("packages.manage");
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">New package</h1>
      <PackageForm id={null} initial={null} />
    </div>
  );
}
