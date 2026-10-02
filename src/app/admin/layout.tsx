import Link from "next/link";
import { FileText, LogOut, Package, Users } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/auth";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffPage();
  const links = [
    can(actor, "applications.view") && { href: "/admin/applications", label: "Applications", icon: FileText },
    can(actor, "packages.view") && { href: "/admin/packages", label: "Packages", icon: Package },
    can(actor, "settings.manage") && { href: "/admin/staff", label: "Staff", icon: Users },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Package }[];
  return (
    <div className="min-h-screen bg-sand/50">
      <header className="bg-ink text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-5">
          <div className="flex items-center gap-4"><Logo dark /><span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-xs tracking-wider text-gold-bright sm:inline">STAFF</span></div>
          <form action={logoutAction}>
            <Button variant="onDark" size="sm" type="submit" className="px-3 sm:px-4" aria-label="Sign out"><LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span></Button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-2 text-sm sm:px-4" aria-label="Admin">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-white/85 hover:bg-white/10 hover:text-white"><l.icon className="size-4" />{l.label}</Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-5 sm:py-10">{children}</div>
    </div>
  );
}
