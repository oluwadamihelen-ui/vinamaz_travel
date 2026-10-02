import Link from "next/link";
import { ArrowRight, FileCheck2, Globe2, LockKeyhole, Route, Search, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoPackagesYet, PackageCard } from "@/components/site/package-card";
import { listPublicPackages } from "@/lib/services/packages";

export const revalidate = 60;

const STEPS = [
  { n: "01", title: "Choose your destination", body: "Browse our travel packages and see exactly what is included and required.", icon: Globe2 },
  { n: "02", title: "Complete your application", body: "A guided, step-by-step form that saves your progress as you go.", icon: FileCheck2 },
  { n: "03", title: "Upload your documents & pay", body: "Upload supporting documents securely, then pay through a trusted gateway.", icon: Upload },
  { n: "04", title: "Track your application", body: "Follow every stage from your dashboard and respond to requests quickly.", icon: Route },
];

const WHY = [
  { title: "Clear, structured applications", body: "Every package lists its requirements up front, so you know what to prepare before you begin.", icon: FileCheck2 },
  { title: "Private document handling", body: "Passports and financial documents are stored privately and only visible to you and authorised Vinamaz staff.", icon: LockKeyhole },
  { title: "Transparent progress", body: "See your application status, outstanding actions and payment history in one place.", icon: Search },
  { title: "Honest expectations", body: "We provide application support. Decisions rest with the embassy or authority, and we never promise outcomes.", icon: ShieldCheck },
];

const FAQ = [
  { q: "Does Vinamaz guarantee my visa?", a: "No. Vinamaz is a visa assistance service, not a government authority. We help you prepare and submit a complete application, but the decision is always made by the relevant embassy or immigration authority." },
  { q: "What does Vinamaz actually do?", a: "We provide eligibility guidance, document preparation support and application processing assistance for the packages we offer." },
  { q: "How do I know what documents I need?", a: "Each package page lists its requirements and required documents once configured. Your application checklist is based on the package you choose." },
  { q: "Is my personal information safe?", a: "Uploaded documents are stored privately and are only accessible to you and authorised staff working on your application." },
  { q: "How can I follow my application?", a: "Sign in to your client dashboard. For privacy, application details are never shown without signing in." },
];

export default async function HomePage() {
  const [all, featured] = await Promise.all([listPublicPackages({ take: 6 }), listPublicPackages({ featuredOnly: true, take: 3 })]);
  const popular = featured.length ? featured : all.slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="route-bg relative overflow-hidden bg-ink text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 md:py-28 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <p className="rise inline-flex items-center gap-2 rounded-full border border-white/20 px-3.5 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-gold-bright">
              <Globe2 className="size-3.5" /> Visa assistance &amp; travel support
            </p>
            <h1 className="rise rise-2 mt-6 text-4xl font-semibold leading-[1.08] sm:text-5xl lg:text-[3.75rem]">
              Your journey starts with the right visa support
            </h1>
            <p className="rise rise-3 mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              Choose a destination, complete a guided application, upload your documents securely and follow every
              step from one clear dashboard.
            </p>
            <div className="rise rise-3 mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="gold" size="lg"><Link href="/packages">Explore travel packages <ArrowRight className="size-5" /></Link></Button>
              <Button asChild variant="onDark" size="lg"><Link href="/login?next=/client/applications">Track my application</Link></Button>
            </div>
          </div>
          <aside className="rise rise-3 hidden rounded-3xl border border-white/15 bg-white/[0.06] p-7 backdrop-blur lg:block" aria-label="What to expect">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-bright">What you get</p>
            <ul className="mt-5 space-y-5">
              {["A checklist built for your chosen package", "Save and resume your application any time", "Private, secure document uploads", "Status updates at every stage"].map((t) => (
                <li key={t} className="flex gap-3 text-[15px] text-white/85"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-bright" />{t}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      {/* Destinations */}
      <section id="destinations" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Available destinations</p>
            <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Travel packages</h2>
          </div>
          {all.length > 0 && <Link href="/packages" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">View all packages <ArrowRight className="size-4" /></Link>}
        </div>
        {all.length ? (
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">{all.map((p) => <PackageCard key={p.id} pkg={p} />)}</div>
        ) : <NoPackagesYet />}
      </section>

      {/* How it works */}
      <section id="how-it-works" className="bg-sand py-20">
        <div className="mx-auto max-w-6xl px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">How Vinamaz works</p>
          <h2 className="mt-2 max-w-xl text-3xl font-semibold sm:text-4xl">Four simple steps from decision to dashboard</h2>
          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="relative rounded-3xl border border-line bg-white p-6 shadow-card">
                <span className="font-display text-5xl font-semibold text-gold-bright/70">{s.n}</span>
                <s.icon className="mt-4 size-6 text-brand" aria-hidden />
                <h3 className="mt-3 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-3">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Why */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Why choose Vinamaz</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold sm:text-4xl">Professional support with total clarity</h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {WHY.map((w) => (
            <div key={w.title} className="flex gap-5">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand"><w.icon className="size-6" aria-hidden /></span>
              <div>
                <h3 className="text-xl font-semibold">{w.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-3">{w.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Popular */}
      {popular.length > 0 && (
        <section className="bg-sand py-20">
          <div className="mx-auto max-w-6xl px-5">
            <h2 className="text-3xl font-semibold sm:text-4xl">{featured.length ? "Popular packages" : "Start with a package"}</h2>
            <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">{popular.map((p) => <PackageCard key={p.id} pkg={p} />)}</div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Frequently asked questions</p>
        <h2 className="mt-2 text-3xl font-semibold sm:text-4xl">Good to know before you apply</h2>
        <div className="mt-8 divide-y divide-line rounded-3xl border border-line bg-white shadow-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-6">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}<span className="text-xl text-gold transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="route-bg bg-ink px-5 py-20 text-center text-white">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold sm:text-4xl">Ready to begin your application?</h2>
        <p className="mx-auto mt-4 max-w-lg text-white/70">Create your free account, pick a package and we&rsquo;ll guide you through each step.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild variant="gold" size="lg"><Link href="/register">Create your account</Link></Button>
          <Button asChild variant="onDark" size="lg"><Link href="/packages">Explore packages</Link></Button>
        </div>
      </section>
    </>
  );
}
