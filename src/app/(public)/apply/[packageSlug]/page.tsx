import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getActor } from "@/lib/auth/session";
import { getPublicPackageBySlug } from "@/lib/services/packages";

export const metadata: Metadata = { title: "Start application" };

type Props = { params: Promise<{ packageSlug: string }> };

/**
 * Phase 1 gate for the application flow. The multi-step wizard is built in Phase 2; for now
 * this validates the package, requires an account, and explains what happens next.
 */
export default async function ApplyPage({ params }: Props) {
  const { packageSlug } = await params;
  const pkg = await getPublicPackageBySlug(packageSlug);
  if (!pkg) notFound();

  const actor = await getActor();
  if (!actor) redirect(`/register?next=${encodeURIComponent(`/apply/${pkg.slug}`)}`);

  return (
    <section className="mx-auto max-w-2xl px-5 py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{pkg.country}</p>
      <h1 className="mt-2 text-4xl font-semibold">{pkg.name}</h1>
      <p className="mt-5 text-ink-3">
        Your account is ready. The guided application form for this package is being finalised and will be available shortly.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Button asChild variant="outline"><Link href={`/packages/${pkg.slug}`}>Back to package</Link></Button>
        <Button asChild><Link href={actor.role === "CLIENT" ? "/client/dashboard" : "/admin"}>Go to my portal</Link></Button>
      </div>
    </section>
  );
}
