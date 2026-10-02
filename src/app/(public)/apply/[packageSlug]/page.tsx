import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startApplicationAction } from "@/lib/actions/applications";
import { getActor } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getPublicPackageBySlug } from "@/lib/services/packages";

export const metadata: Metadata = { title: "Start application" };

type Props = { params: Promise<{ packageSlug: string }> };

/** Entry point for applying: requires a client account, then starts or resumes the draft. */
export default async function ApplyPage({ params }: Props) {
  const { packageSlug } = await params;
  const pkg = await getPublicPackageBySlug(packageSlug);
  if (!pkg) notFound();

  const actor = await getActor();
  if (!actor) redirect(`/register?next=${encodeURIComponent(`/apply/${pkg.slug}`)}`);

  const draft = actor.role === "CLIENT"
    ? await db.visaApplication.findFirst({ where: { clientId: actor.id, packageId: pkg.id, status: "DRAFT" }, select: { id: true, applicationNumber: true, progressPercent: true } })
    : null;

  return (
    <section className="mx-auto max-w-2xl px-5 py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{pkg.country}</p>
      <h1 className="mt-2 text-4xl font-semibold">{pkg.name}</h1>
      {actor.role !== "CLIENT" ? (
        <p className="mt-5 text-ink-3">Applications can only be started from a client account. You are signed in as staff.</p>
      ) : draft ? (
        <>
          <p className="mt-5 text-ink-3">You have an application in progress ({draft.applicationNumber}, {draft.progressPercent}% complete).</p>
          <form action={startApplicationAction.bind(null, pkg.slug)} className="mt-8"><Button size="lg">Continue application</Button></form>
        </>
      ) : (
        <>
          <p className="mt-5 text-ink-3">We&rsquo;ll guide you through each step. Your progress is saved automatically, so you can leave and come back at any time.</p>
          <form action={startApplicationAction.bind(null, pkg.slug)} className="mt-8"><Button size="lg">Begin application</Button></form>
        </>
      )}
      <p className="mt-6"><Link href={`/packages/${pkg.slug}`} className="text-sm font-medium text-teal hover:underline">Back to package details</Link></p>
    </section>
  );
}
