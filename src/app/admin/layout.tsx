import Link from "next/link";
import { LogOut, Package } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/auth";
import { requireStaffPage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaffPage();
  return (
    <div className="min-h-screen bg-sand/50">
      <header className="bg-ink text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-5">
          <div className="flex items-center gap-4"><Logo dark /><span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-xs tracking-wider text-gold-bright sm:inline">STAFF</span></div>
          <nav className="flex items-center gap-1 text-sm" aria-label="Admin">
            {can(actor, "packages.view") && <Link href="/admin/packages" className="flex items-center gap-2 rounded-full px-3 py-2 hover:bg-white/10"><Package className="size-4" />Packages</Link>}
            <form action={logoutAction}><Button variant="onDark" size="sm" type="submit" className="ml-1 px-3 sm:px-4" aria-label="Sign out"><LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span></Button></form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-5 py-10">{children}</div>
    </div>
  );
}
