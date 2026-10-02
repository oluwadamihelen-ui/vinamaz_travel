import type { Metadata } from "next";
import { NotificationList } from "@/components/messages/notification-list";
import { requireStaffPage } from "@/lib/auth/session";
import { listNotifications } from "@/lib/services/notifications";

export const metadata: Metadata = { title: "Notifications · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminNotifications() {
  const actor = await requireStaffPage("notifications.view");
  return <NotificationList items={await listNotifications(actor, { limit: 50 })} />;
}
