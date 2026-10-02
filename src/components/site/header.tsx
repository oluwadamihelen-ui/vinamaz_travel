import Link from "next/link";
import { HeaderActions } from "./header-actions";
import { Logo } from "./logo";

const NAV = [
  { href: "/packages", label: "Packages" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm font-medium text-ink-3 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="transition-colors hover:text-ink">{n.label}</Link>
          ))}
          <Link href="/login?next=/client/applications" className="transition-colors hover:text-ink">Track my application</Link>
        </nav>
        <HeaderActions />
      </div>
      <nav className="flex gap-6 overflow-x-auto border-t border-line/60 px-5 py-2.5 text-sm font-medium text-ink-3 md:hidden" aria-label="Main mobile">
        {NAV.map((n) => <Link key={n.href} href={n.href} className="whitespace-nowrap">{n.label}</Link>)}
        <Link href="/login?next=/client/applications" className="whitespace-nowrap">Track my application</Link>
      </nav>
    </header>
  );
}
