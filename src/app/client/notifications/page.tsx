import type { Metadata } from "next";
import { NotificationList } from "@/components/messages/notification-list";
import { requireClientPage } from "@/lib/auth/session";
import { listNotifications } from "@/lib/services/notifications";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function ClientNotifications() {
  const actor = await requireClientPage();
  return <NotificationList items={await listNotifications(actor, { limit: 50 })} />;
}
