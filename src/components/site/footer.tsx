import Link from "next/link";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="bg-ink text-white/80">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo dark />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            Vinamaz provides visa assistance and travel application support. We help you prepare and submit your
            application. Visa decisions are made solely by the relevant embassy or immigration authority.
          </p>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-bright">Explore</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:text-white" href="/packages">Travel packages</Link></li>
            <li><Link className="hover:text-white" href="/#how-it-works">How it works</Link></li>
            <li><Link className="hover:text-white" href="/#faq">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gold-bright">Account</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:text-white" href="/login">Sign in</Link></li>
            <li><Link className="hover:text-white" href="/register">Create account</Link></li>
            <li><Link className="hover:text-white" href="/login?next=/client/applications">Track my application</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-5 text-center text-xs text-white/50">
        © {new Date().getFullYear()} Vinamaz Travels. Vinamaz Travels is not a government agency and does not guarantee visa approval.
      </div>
    </footer>
  );
}
