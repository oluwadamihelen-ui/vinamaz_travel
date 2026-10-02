import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { requireClient, requirePermission, type Actor } from "@/lib/auth/actor";
import { rateLimit } from "@/lib/rate-limit";
import { getPrivateStorage } from "@/lib/storage/private-documents";
import { applicationScope, getManagedApplication } from "./admin-applications";
import { getOwnedApplication } from "./applications";
import { recordAudit } from "./audit";
import { onMessageSent } from "./events";

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** Which side of the conversation an actor is on. Clients are always the CLIENT side. */
const sideOf = (actor: Actor) => (actor.role === "CLIENT" ? "CLIENT" : "STAFF") as "CLIENT" | "STAFF";

/** Authorise access to an application's conversation (client owns it, or staff may view messages in scope). */
export async function authoriseConversation(actor: Actor, applicationId: string, level: "view" | "send") {
  if (actor.role === "CLIENT") {
    const app = await getOwnedApplication(actor, applicationId);
    return app;
  }
  return getManagedApplication(actor, applicationId, level === "send" ? "messages.manage" : "messages.view");
}

export interface MessageView {
  id: string;
  body: string;
  senderRole: "CLIENT" | "STAFF";
  senderName: string;
  mine: boolean;
  createdAt: Date;
  readAt: Date | null;
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number }[];
}

/** The conversation for one application, oldest first. Authorisation is by ownership/scope, never by id alone. */
export async function listMessages(actor: Actor, applicationId: string): Promise<MessageView[]> {
  const app = await authoriseConversation(actor, applicationId, "view");
  const rows = await db.applicationMessage.findMany({
    where: { applicationId: app.id }, orderBy: { createdAt: "asc" }, take: 500,
    include: { attachments: { orderBy: { createdAt: "asc" } } },
  });
  const senderIds = [...new Set(rows.map((r) => r.senderId).filter((x): x is string => !!x))];
  const senders = senderIds.length ? await db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(senders.map((s) => [s.id, s.name]));
  return rows.map((r) => ({
    id: r.id, body: r.body, senderRole: r.senderRole, createdAt: r.createdAt, readAt: r.readAt,
    // Clients see "Vinamaz Travels" for staff messages rather than a staff member's personal details.
    senderName: r.senderRole === "STAFF" && actor.role === "CLIENT" ? "Vinamaz Travels" : (r.senderId ? names.get(r.senderId) : null) ?? "Unknown",
    mine: r.senderId === actor.id,
    attachments: r.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
  }));
}

/** Mark everything the OTHER side sent as read. Idempotent. */
export async function markConversationRead(actor: Actor, applicationId: string): Promise<number> {
  const app = await authoriseConversation(actor, applicationId, "view");
  const res = await db.applicationMessage.updateMany({
    where: { applicationId: app.id, senderRole: sideOf(actor) === "CLIENT" ? "STAFF" : "CLIENT", readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}

export async function sendMessage(actor: Actor, applicationId: string, input: { body: string; uploadIds?: string[] }) {
  const app = await authoriseConversation(actor, applicationId, "send");
  if (app.status === "DRAFT") throw new AppError("Messaging opens once the application has been submitted.", "FORBIDDEN");
  const body = input.body.trim();
  const uploadIds = [...new Set(input.uploadIds ?? [])];
  if (!body && uploadIds.length === 0) throw new AppError("Write a message first.", "VALIDATION", { body: ["Required"] });
  if (body.length > MAX_MESSAGE_LENGTH) throw new AppError(`That message is too long (maximum ${MAX_MESSAGE_LENGTH} characters).`, "VALIDATION", { body: ["Too long"] });
  if (uploadIds.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new AppError(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`, "VALIDATION");
  if (!(await rateLimit(`message:${actor.id}`, 30, 10 * 60_000)).ok) throw new AppError("You're sending messages very quickly. Please wait a moment.", "VALIDATION");

  // Attachments must be uploads THIS user completed for THIS application, and not already used.
  const uploads = uploadIds.length
    ? await db.pendingUpload.findMany({ where: { id: { in: uploadIds }, userId: actor.id, applicationId: app.id, kind: "MESSAGE_ATTACHMENT", completedAt: { not: null } } })
    : [];
  if (uploads.length !== uploadIds.length) throw new AppError("One of the attachments isn't available any more. Please attach it again.", "VALIDATION");
  const used = uploads.length ? await db.applicationMessageAttachment.count({ where: { storageKey: { in: uploads.map((u) => u.storageKey) } } }) : 0;
  if (used > 0) throw new AppError("One of the attachments was already sent.", "CONFLICT");

  const message = await db.applicationMessage.create({
    data: {
      applicationId: app.id, senderId: actor.id, senderRole: sideOf(actor), body,
      attachments: {
        create: uploads.map((u) => ({
          storageKey: u.storageKey, filename: u.filename, mimeType: mimeFromKey(u.storageKey), sizeBytes: u.declaredSize,
        })),
      },
    },
  });
  await recordAudit({ actorId: actor.id, action: "message.sent", entityType: "ApplicationMessage", entityId: message.id, metadata: { applicationId: app.id, attachments: uploads.length, side: sideOf(actor) } });
  await onMessageSent(message.id);
  return message;
}

function mimeFromKey(key: string): string {
  return key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".png") ? "image/png" : "image/jpeg";
}

/** Authorised read of one attachment (conversation participants only). */
export async function openMessageAttachment(actor: Actor | null, attachmentId: string) {
  if (!actor) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  const att = await db.applicationMessageAttachment.findUnique({ where: { id: attachmentId }, include: { message: { select: { applicationId: true } } } });
  if (!att) throw new AppError("We couldn't find that file.", "NOT_FOUND");
  await authoriseConversation(actor, att.message.applicationId, "view"); // throws NOT_FOUND/FORBIDDEN outside ownership/scope
  if (actor.role !== "CLIENT") await recordAudit({ actorId: actor.id, action: "message.attachment_downloaded", entityType: "ApplicationMessageAttachment", entityId: att.id, metadata: { applicationId: att.message.applicationId } });
  const object = await getPrivateStorage().get(att.storageKey);
  if (!object) throw new AppError("We couldn't retrieve that file.", "NOT_FOUND");
  return { att, object };
}

// ---------------------------------------------------------------------------
// Unread tracking and inboxes
// ---------------------------------------------------------------------------

/** Unread staff replies waiting for this client, per application. */
export async function clientUnreadByApplication(actor: Actor): Promise<Map<string, number>> {
  requireClient(actor);
  const rows = await db.applicationMessage.groupBy({
    by: ["applicationId"], _count: { _all: true },
    where: { senderRole: "STAFF", readAt: null, application: { clientId: actor.id } },
  });
  return new Map(rows.map((r) => [r.applicationId, r._count._all]));
}

/** Unread client messages inside this staff member's scope. */
export async function staffUnreadCount(actor: Actor): Promise<number> {
  if (actor.role === "CLIENT" || !can(actor, "messages.view")) return 0;
  return db.applicationMessage.count({ where: { senderRole: "CLIENT", readAt: null, application: applicationScope(actor) } });
}

export interface ConversationSummary {
  applicationId: string;
  applicationNumber: string;
  clientName: string;
  packageName: string;
  unread: number;
  lastMessageAt: Date;
  lastPreview: string;
  lastFromClient: boolean;
}

/** Staff inbox: conversations in scope, unread first, then most recent. */
export async function listConversations(actor: Actor, opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<ConversationSummary[]> {
  requirePermission(actor, "messages.view");
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  const scope = applicationScope(actor);
  const where: Prisma.ApplicationMessageWhereInput = { application: scope };
  const latest = await db.applicationMessage.groupBy({ by: ["applicationId"], where, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 200 });
  if (latest.length === 0) return [];
  const ids = latest.map((l) => l.applicationId);
  const [apps, unread, lastMessages] = await Promise.all([
    db.visaApplication.findMany({ where: { id: { in: ids } }, select: { id: true, applicationNumber: true, packageName: true, client: { select: { name: true } } } }),
    db.applicationMessage.groupBy({ by: ["applicationId"], _count: { _all: true }, where: { applicationId: { in: ids }, senderRole: "CLIENT", readAt: null } }),
    db.applicationMessage.findMany({ where: { applicationId: { in: ids } }, orderBy: { createdAt: "desc" }, distinct: ["applicationId"], select: { applicationId: true, body: true, senderRole: true, createdAt: true, _count: { select: { attachments: true } } } }),
  ]);
  const appById = new Map(apps.map((a) => [a.id, a]));
  const unreadBy = new Map(unread.map((u) => [u.applicationId, u._count._all]));
  const lastBy = new Map(lastMessages.map((m) => [m.applicationId, m]));
  const out: ConversationSummary[] = [];
  for (const l of latest) {
    const a = appById.get(l.applicationId);
    const last = lastBy.get(l.applicationId);
    if (!a || !last) continue;
    const un = unreadBy.get(l.applicationId) ?? 0;
    if (opts.unreadOnly && un === 0) continue;
    out.push({
      applicationId: a.id, applicationNumber: a.applicationNumber, clientName: a.client.name, packageName: a.packageName, unread: un,
      lastMessageAt: last.createdAt, lastFromClient: last.senderRole === "CLIENT",
      lastPreview: (last.body || (last._count.attachments ? "Sent an attachment" : "")).slice(0, 140),
    });
  }
  out.sort((x, y) => (y.unread > 0 ? 1 : 0) - (x.unread > 0 ? 1 : 0) || y.lastMessageAt.getTime() - x.lastMessageAt.getTime());
  return out.slice(0, opts.limit ?? 100);
}
