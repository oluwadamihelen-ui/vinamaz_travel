import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/utils";
import type { PackageCard as PackageCardData } from "@/lib/services/packages";

/**
 * Shows the WHOLE artwork (object-contain) so posters of any shape are never cropped or
 * off-centre; a blurred copy of the same image fills the leftover space.
 */
export function PackageImage({ url, alt, name, country, priority }: { url: string | null; alt?: string | null; name: string; country: string; priority?: boolean }) {
  if (url) {
    const sizes = "(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw";
    return (
      <div className="relative h-full w-full overflow-hidden bg-sand">
        <Image src={url} alt="" aria-hidden fill sizes={sizes} className="scale-125 object-cover opacity-70 blur-2xl" />
        <Image src={url} alt={alt || `${name} — ${country}`} fill sizes={sizes} priority={priority} className="object-contain object-center transition-transform duration-700 group-hover:scale-[1.03]" />
      </div>
    );
  }
  // Neutral placeholder until an administrator uploads the real artwork.
  return (
    <div className="route-bg flex h-full w-full items-end bg-ink p-6" aria-hidden="true">
      <span className="font-display text-4xl font-semibold uppercase tracking-[0.18em] text-white/90">{country}</span>
    </div>
  );
}

export function PackageCard({ pkg }: { pkg: PackageCardData }) {
  const price = formatMoney(pkg.price, pkg.currency);
  const highlights = pkg.inclusions.slice(0, 3);
  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
      <Link href={`/packages/${pkg.slug}`} className="relative block aspect-[4/3] overflow-hidden" tabIndex={-1} aria-hidden="true">
        <PackageImage url={pkg.imageUrl} alt={pkg.imageAlt} name={pkg.name} country={pkg.country} />
      </Link>
      <div className="flex flex-1 flex-col p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{pkg.country}</p>
        <h3 className="mt-1.5 text-2xl font-semibold leading-tight">{pkg.name}</h3>
        {pkg.shortDescription && <p className="mt-2 text-[15px] leading-relaxed text-ink-3">{pkg.shortDescription}</p>}

        {(price || pkg.processingEstimate) && (
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {price && <div><dt className="text-xs text-ink-3">Starting from</dt><dd className="font-semibold">{price}</dd></div>}
            {pkg.processingEstimate && (
              <div><dt className="text-xs text-ink-3">Processing estimate</dt><dd className="flex items-center gap-1.5 font-semibold"><Clock className="size-3.5 text-brand" />{pkg.processingEstimate}</dd></div>
            )}
          </dl>
        )}
        {highlights.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-ink-3">
            {highlights.map((h) => <li key={h} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" />{h}</li>)}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap gap-3 pt-6">
          <Button asChild variant="outline" size="sm"><Link href={`/packages/${pkg.slug}`}>View details</Link></Button>
          <Button asChild size="sm"><Link href={`/apply/${pkg.slug}`}>Apply now <ArrowRight className="size-4" /></Link></Button>
        </div>
      </div>
    </article>
  );
}

export function NoPackagesYet() {
  return (
    <div className="rounded-3xl border border-dashed border-line bg-white/60 px-6 py-14 text-center">
      <p className="font-display text-2xl font-semibold">Destinations are being prepared</p>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-3">
        Our travel packages will appear here as soon as they are published. Create an account to be ready when they are.
      </p>
    </div>
  );
}
