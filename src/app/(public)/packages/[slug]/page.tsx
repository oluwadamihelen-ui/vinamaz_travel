import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { PackageImage } from "@/components/site/package-card";
import { getPublicPackageBySlug } from "@/lib/services/packages";
import { formatMoney } from "@/lib/utils";

export const revalidate = 60;
/** Pages are rendered on first request, then cached and refreshed every minute (and on package edits). */
export const generateStaticParams = async () => [];

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const pkg = await getPublicPackageBySlug((await params).slug);
  if (!pkg) return { title: "Package not found" };
  return { title: pkg.name, description: pkg.shortDescription ?? undefined };
}

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-line py-10 first:border-t-0 first:pt-0">
      <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  return <div className="space-y-4 text-[16px] leading-relaxed text-ink-3">{text.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}</div>;
}

export default async function PackagePage({ params }: Props) {
  const pkg = await getPublicPackageBySlug((await params).slug);
  if (!pkg) notFound();

  const price = formatMoney(pkg.price, pkg.currency);
  const appFee = formatMoney(pkg.applicationFee, pkg.currency);
  const serviceFee = formatMoney(pkg.serviceFee, pkg.currency);
  const eligibility = pkg.requirements.filter((r) => r.type === "ELIGIBILITY");
  const requirements = pkg.requirements.filter((r) => r.type === "REQUIREMENT");
  const hasFees = Boolean(price || appFee || serviceFee);
  const startHref = `/apply/${pkg.slug}`;

  return (
    <>
      <section className="route-bg bg-ink text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 md:py-20 lg:grid-cols-2">
          <div>
            <nav aria-label="Breadcrumb" className="text-sm text-white/60"><Link href="/packages" className="hover:text-white">Packages</Link> / {pkg.country}</nav>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.25em] text-gold-bright">{pkg.country}</p>
            <h1 className="mt-2 text-4xl font-semibold leading-tight sm:text-5xl">{pkg.name}</h1>
            {pkg.category && <Badge tone="gold" className="mt-4">{pkg.category}</Badge>}
            {pkg.shortDescription && <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/75">{pkg.shortDescription}</p>}
            {(price || pkg.processingEstimate) && (
              <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
                {price && <div><dt className="text-xs uppercase tracking-wider text-white/50">Package price</dt><dd className="text-2xl font-semibold">{price}</dd></div>}
                {pkg.processingEstimate && <div><dt className="text-xs uppercase tracking-wider text-white/50">Processing estimate</dt><dd className="flex items-center gap-2 text-2xl font-semibold"><Clock className="size-5 text-gold-bright" />{pkg.processingEstimate}</dd></div>}
              </dl>
            )}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="gold" size="lg"><Link href={startHref}>Start application <ArrowRight className="size-5" /></Link></Button>
              {(requirements.length > 0 || pkg.documentRequirements.length > 0) && (
                <Button asChild variant="onDark" size="lg"><a href="#requirements">View requirements</a></Button>
              )}
            </div>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 shadow-lift">
            <PackageImage url={pkg.imageUrl} alt={pkg.imageAlt} name={pkg.name} country={pkg.country} priority />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 lg:grid-cols-[1fr_320px]">
        <div>
          {pkg.description && <Section title="Overview"><Paragraphs text={pkg.description} /></Section>}

          {pkg.inclusions.length > 0 && (
            <Section title="What's included">
              <ul className="grid gap-3 sm:grid-cols-2">{pkg.inclusions.map((i) => <li key={i} className="flex gap-3 rounded-2xl bg-white p-4 text-[15px] shadow-card"><Check className="mt-0.5 size-5 shrink-0 text-brand" />{i}</li>)}</ul>
              {pkg.exclusions.length > 0 && (
                <>
                  <h3 className="mt-8 text-lg font-semibold">Not included</h3>
                  <ul className="mt-3 space-y-2">{pkg.exclusions.map((i) => <li key={i} className="flex gap-3 text-[15px] text-ink-3"><X className="mt-0.5 size-5 shrink-0 text-danger/70" />{i}</li>)}</ul>
                </>
              )}
            </Section>
          )}

          {(eligibility.length > 0 || requirements.length > 0 || pkg.documentRequirements.length > 0) && (
            <Section id="requirements" title="Requirements">
              {eligibility.length > 0 && (
                <>
                  <h3 className="text-lg font-semibold">Eligibility</h3>
                  <ul className="mt-3 space-y-3">{eligibility.map((r) => <li key={r.id} className="text-[15px]"><span className="font-medium">{r.title}</span>{r.description && <span className="text-ink-3"> — {r.description}</span>}</li>)}</ul>
                </>
              )}
              {requirements.length > 0 && (
                <>
                  <h3 className={`text-lg font-semibold ${eligibility.length ? "mt-8" : ""}`}>General requirements</h3>
                  <ul className="mt-3 space-y-3">{requirements.map((r) => <li key={r.id} className="text-[15px]"><span className="font-medium">{r.title}</span>{r.description && <span className="text-ink-3"> — {r.description}</span>}</li>)}</ul>
                </>
              )}
              {pkg.documentRequirements.length > 0 && (
                <>
                  <h3 className={`text-lg font-semibold ${eligibility.length || requirements.length ? "mt-8" : ""}`}>Documents you will need</h3>
                  <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
                    {pkg.documentRequirements.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 p-4">
                        <div><p className="font-medium">{d.name}</p>{d.description && <p className="mt-0.5 text-sm text-ink-3">{d.description}</p>}</div>
                        <Badge tone={d.isRequired ? "gold" : "neutral"}>{d.isRequired ? "Required" : "Optional"}</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          )}

          <Section title="Application process">
            <ol className="space-y-3 text-[15px] text-ink-3">
              {["Create your account and start your application.", "Complete the guided application. Your progress is saved automatically.", "Upload your documents and complete payment securely.", "Track progress and respond to any requests from your dashboard."].map((s, i) => (
                <li key={s} className="flex gap-4"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{i + 1}</span><span className="pt-0.5">{s}</span></li>
              ))}
            </ol>
          </Section>

          {pkg.importantInfo && <Section title="Important information"><Paragraphs text={pkg.importantInfo} /></Section>}

          {pkg.faqs.length > 0 && (
            <Section title="Frequently asked questions">
              <div className="divide-y divide-line rounded-2xl border border-line bg-white">
                {pkg.faqs.map((f) => (
                  <details key={f.question} className="group p-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{f.question}<span className="text-xl text-gold transition-transform group-open:rotate-45" aria-hidden>+</span></summary>
                    <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink-3">{f.answer}</p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          <Section title="Terms &amp; disclaimer">
            {pkg.terms && <Paragraphs text={pkg.terms} />}
            <p className={`text-sm leading-relaxed text-ink-3 ${pkg.terms ? "mt-4" : ""}`}>
              Vinamaz provides visa assistance and application support services. Vinamaz is not a government agency or embassy and cannot guarantee that a visa will be granted. Final decisions are made solely by the relevant immigration authority.
            </p>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-3xl border border-line bg-white p-6 shadow-card">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{pkg.country}</p>
            <p className="mt-1 font-display text-xl font-semibold">{pkg.name}</p>
            {hasFees && (
              <dl className="mt-5 space-y-3 border-t border-line pt-5 text-sm">
                {price && <div className="flex justify-between gap-4"><dt className="text-ink-3">Package price</dt><dd className="font-semibold">{price}</dd></div>}
                {appFee && <div className="flex justify-between gap-4"><dt className="text-ink-3">Application fee</dt><dd className="font-semibold">{appFee}</dd></div>}
                {serviceFee && <div className="flex justify-between gap-4"><dt className="text-ink-3">Service fee</dt><dd className="font-semibold">{serviceFee}</dd></div>}
              </dl>
            )}
            {pkg.processingEstimate && <p className="mt-4 flex items-center gap-2 text-sm text-ink-3"><Clock className="size-4 text-brand" /> {pkg.processingEstimate}</p>}
            <Button asChild className="mt-6 w-full" size="lg"><Link href={startHref}>Start application</Link></Button>
            <p className="mt-3 text-center text-xs text-ink-3">A free Vinamaz account is required to apply.</p>
          </div>
        </aside>
      </div>
    </>
  );
}
