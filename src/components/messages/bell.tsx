import Link from "next/link";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

/** Header bell with an unread badge. Counts are computed server-side per request. */
export function NotificationBell({ href, count, dark }: { href: string; count: number; dark?: boolean }) {
  return (
    <Link href={href} aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"} className={cn("relative inline-flex size-10 items-center justify-center rounded-full", dark ? "text-white/85 hover:bg-white/10" : "text-ink hover:bg-sand")}>
      <Bell className="size-5" aria-hidden />
      {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-gold-bright px-1 text-[11px] font-bold leading-5 text-ink">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
