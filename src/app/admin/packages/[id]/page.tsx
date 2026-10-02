import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PackageForm, type PackageFormData } from "@/components/admin/package-form";
import { requireStaffPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getAdminPackage } from "@/lib/services/packages";

export const metadata: Metadata = { title: "Edit package · Admin" };

export default async function EditPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffPage("packages.manage");
  const { id } = await params;
  let pkg;
  try {
    pkg = await getAdminPackage(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const initial: PackageFormData = {
    name: pkg.name, country: pkg.country, slug: pkg.slug, category: pkg.category ?? "",
    shortDescription: pkg.shortDescription ?? "", description: pkg.description ?? "",
    imageUrl: pkg.imageUrl, imageAlt: pkg.imageAlt ?? "",
    price: pkg.price?.toString() ?? "", applicationFee: pkg.applicationFee?.toString() ?? "", serviceFee: pkg.serviceFee?.toString() ?? "",
    currency: pkg.currency, processingEstimate: pkg.processingEstimate ?? "",
    inclusions: pkg.inclusions, exclusions: pkg.exclusions,
    importantInfo: pkg.importantInfo ?? "", terms: pkg.terms ?? "", faqs: pkg.faqs,
    status: pkg.status, isFeatured: pkg.isFeatured, displayOrder: pkg.displayOrder,
    requirements: pkg.requirements.map((r) => ({ type: r.type, title: r.title, description: r.description ?? "" })),
    documentRequirements: pkg.documentRequirements.map((d) => ({
      key: d.key, name: d.name, description: d.description ?? "", isRequired: d.isRequired,
      acceptedFormats: d.acceptedFormats as ("pdf" | "jpg" | "png")[], maxSizeMb: d.maxSizeMb,
    })),
    questions: pkg.questions.map((q) => ({
      key: q.key, label: q.label, helpText: q.helpText ?? "", type: q.type, isRequired: q.isRequired, section: q.section ?? "",
      condition: (q.condition as PackageFormData["questions"][number]["condition"]) ?? null,
      options: q.options.map((o) => ({ label: o.label, value: o.value })),
    })),
  };
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Edit package</h1>
      <PackageForm id={pkg.id} initial={initial} />
    </div>
  );
}
