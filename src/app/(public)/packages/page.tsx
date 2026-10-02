import type { Metadata } from "next";
import { NoPackagesYet, PackageCard } from "@/components/site/package-card";
import { listPublicPackages } from "@/lib/services/packages";

export const revalidate = 60;
export const metadata: Metadata = { title: "Travel packages", description: "Browse Vinamaz visa assistance and travel application packages." };

export default async function PackagesPage() {
  const packages = await listPublicPackages();
  return (
    <>
      <section className="route-bg bg-ink text-white">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-bright">Destinations</p>
          <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">Travel packages</h1>
          <p className="mt-4 max-w-xl text-lg text-white/70">Professional application support and document guidance, tailored to your destination.</p>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-5 py-16">
        {packages.length ? (
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">{packages.map((p) => <PackageCard key={p.id} pkg={p} />)}</div>
        ) : <NoPackagesYet />}
      </section>
    </>
  );
}
