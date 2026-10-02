import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Badge, Card } from "@/components/ui/misc";
import { requireStaffPage } from "@/lib/auth/session";
import { listConversations } from "@/lib/services/messages";

export const metadata: Metadata = { title: "Messages · Admin" };
export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ unread?: string }> }) {
  const actor = await requireStaffPage("messages.view");
  const unreadOnly = (await searchParams).unread === "1";
  const items = await listConversations(actor, { unreadOnly });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl font-semibold">Messages</h1><p className="mt-1 text-ink-3">Conversations with clients, newest and unread first. Staff only see applications assigned to them.</p></div>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/messages" className={`rounded-full px-4 py-2 ${!unreadOnly ? "bg-ink text-white" : "bg-white text-ink-3 hover:bg-sand"}`}>All</Link>
          <Link href="/admin/messages?unread=1" className={`rounded-full px-4 py-2 ${unreadOnly ? "bg-ink text-white" : "bg-white text-ink-3 hover:bg-sand"}`}>Unread</Link>
        </div>
      </div>
      {items.length === 0 ? (
        <Card className="p-10 text-center text-ink-3"><MessageSquare className="mx-auto mb-3 size-8 text-ink-3/50" aria-hidden />{unreadOnly ? "No unread messages." : "No conversations yet."}</Card>
      ) : (
        <Card className="divide-y divide-line">
          {items.map((c) => (
            <Link key={c.applicationId} href={`/admin/applications/${c.applicationId}?tab=messages`} className="flex items-start gap-4 p-4 hover:bg-sand/50">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">{c.clientName}<span className="text-xs font-normal text-ink-3">{c.applicationNumber} · {c.packageName}</span>{c.unread > 0 && <Badge tone="brand">{c.unread} unread</Badge>}</p>
                <p className="mt-0.5 truncate text-sm text-ink-3">{c.lastFromClient ? "" : "You: "}{c.lastPreview}</p>
              </div>
              <p className="shrink-0 text-xs text-ink-3">{when(c.lastMessageAt)}</p>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
