import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { AppError } from "@/lib/errors";

/** In-app notifications. Every query is scoped to the acting user; ids from the browser are never trusted alone. */

export async function listNotifications(actor: Actor, opts: { limit?: number; unreadOnly?: boolean } = {}) {
  return db.notification.findMany({
    where: { userId: actor.id, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" }, take: Math.min(opts.limit ?? 30, 100),
  });
}

export function unreadNotificationCount(actor: Actor): Promise<number> {
  return db.notification.count({ where: { userId: actor.id, readAt: null } });
}

export async function markNotificationRead(actor: Actor, id: string): Promise<{ href: string | null }> {
  const n = await db.notification.findFirst({ where: { id, userId: actor.id }, select: { id: true, href: true, readAt: true } });
  if (!n) throw new AppError("We couldn't find that notification.", "NOT_FOUND");
  if (!n.readAt) await db.notification.updateMany({ where: { id: n.id, userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  return { href: n.href };
}

export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  const res = await db.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  return res.count;
}
