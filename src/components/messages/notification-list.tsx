import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/misc";
import { markAllReadAction, openNotificationAction } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";

export interface NotificationRow { id: string; title: string; body: string | null; href: string | null; readAt: Date | null; createdAt: Date }

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function NotificationList({ items }: { items: NotificationRow[] }) {
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-semibold">Notifications</h1><p className="mt-1 text-ink-3">{unread > 0 ? `${unread} unread` : "You're all caught up."}</p></div>
        {unread > 0 && <form action={markAllReadAction}><Button type="submit" variant="outline" size="sm">Mark all as read</Button></form>}
      </div>
      {items.length === 0 ? (
        <Card className="p-10 text-center text-ink-3"><Bell className="mx-auto mb-3 size-8 text-ink-3/50" aria-hidden />Nothing here yet.</Card>
      ) : (
        <Card className="divide-y divide-line">
          {items.map((n) => (
            <form key={n.id} action={openNotificationAction.bind(null, n.id)}>
              <button type="submit" className={cn("flex w-full items-start gap-3 p-4 text-left hover:bg-sand/50", !n.readAt && "bg-gold-soft/40")}>
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{n.title}{!n.readAt && <Badge tone="brand" className="ml-2">New</Badge>}</span>
                  {n.body && <span className="block text-sm text-ink-3">{n.body}</span>}
                  <span className="block text-xs text-ink-3">{when(n.createdAt)}</span>
                </span>
              </button>
            </form>
          ))}
        </Card>
      )}
    </div>
  );
}
