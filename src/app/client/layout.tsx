import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { requireClientPage } from "@/lib/auth/session";
import { logoutAction } from "@/lib/actions/auth";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClientPage();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Logo />
          <nav className="flex items-center gap-1 text-sm font-medium" aria-label="Client">
            <Link href="/client/dashboard" className="rounded-full px-4 py-2 hover:bg-sand">Dashboard</Link>
            <Link href="/packages" className="hidden rounded-full px-4 py-2 hover:bg-sand sm:block">Packages</Link>
            <form action={logoutAction}><Button variant="ghost" size="sm" type="submit" aria-label="Sign out"><LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span></Button></form>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10" data-user={actor.id}>{children}</div>
    </div>
  );
}
