import Link from "next/link";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/messages/bell";
import { requireClientPage } from "@/lib/auth/session";
import { unreadNotificationCount } from "@/lib/services/notifications";
import { logoutAction } from "@/lib/actions/auth";

const LINKS = [
  { href: "/client/dashboard", label: "Dashboard" },
  { href: "/client/applications", label: "Applications" },
  { href: "/client/payments", label: "Payments" },
  { href: "/packages", label: "Packages" },
];

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireClientPage();
  const unread = await unreadNotificationCount(actor);
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5">
          <Logo />
          <nav className="hidden items-center gap-1 text-sm font-medium sm:flex" aria-label="Client">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className="rounded-full px-4 py-2 hover:bg-sand">{l.label}</Link>)}
          </nav>
          <div className="flex items-center gap-1">
            <NotificationBell href="/client/notifications" count={unread} />
            <form action={logoutAction}>
              <Button variant="ghost" size="sm" type="submit" aria-label="Sign out"><LogOut className="size-4" /><span className="hidden sm:inline">Sign out</span></Button>
            </form>
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto border-t border-line px-5 py-2 text-sm font-medium sm:hidden" aria-label="Client mobile">
          {LINKS.map((l) => <Link key={l.href} href={l.href} className="flex min-h-10 items-center whitespace-nowrap rounded-full px-4 hover:bg-sand">{l.label}</Link>)}
        </nav>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10">{children}</div>
    </div>
  );
}
