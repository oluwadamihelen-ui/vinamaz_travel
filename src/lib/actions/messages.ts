"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { sendMessage } from "@/lib/services/messages";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/services/notifications";

export interface MessageState { ok?: boolean; error?: string }

/** Only the application id, text and ids of this user's completed uploads come from the browser; the service re-checks all of it. */
export async function sendMessageAction(applicationId: string, body: string, uploadIds: string[]): Promise<MessageState> {
  try {
    const actor = await getActor();
    if (!actor) return { error: "Please sign in to continue." };
    await sendMessage(actor, applicationId, { body, uploadIds });
    revalidatePath(actor.role === "CLIENT" ? `/client/applications/${applicationId}` : `/admin/applications/${applicationId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    console.error("[send message]", e);
    return { error: "Your message couldn't be sent. Please try again." };
  }
}

/** Mark one notification read and go where it points. */
export async function openNotificationAction(id: string) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  let href: string | null = null;
  try {
    href = (await markNotificationRead(actor, id)).href;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
  }
  const base = actor.role === "CLIENT" ? "/client/notifications" : "/admin/notifications";
  // Hrefs are written by the server, but only ever follow same-site relative paths.
  redirect(href && href.startsWith("/") && !href.startsWith("//") ? href : base);
}

export async function markAllReadAction() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  await markAllNotificationsRead(actor);
  revalidatePath(actor.role === "CLIENT" ? "/client/notifications" : "/admin/notifications");
}
