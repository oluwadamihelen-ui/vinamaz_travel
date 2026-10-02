import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission, type Actor } from "@/lib/auth/actor";

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Best-effort audit write: a logging failure must never break the user's action. */
export async function recordAudit(entry: AuditEntry, client: Pick<typeof db, "auditLog"> = db): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record", entry.action, error);
  }
}

// ---------------------------------------------------------------------------
// Viewing the audit log (audit.view; super admins by default)
// ---------------------------------------------------------------------------

export interface AuditFilters { q?: string; action?: string; entityType?: string; from?: string; to?: string; page?: number }

const AUDIT_PAGE_SIZE = 50;

export async function listAuditLog(actor: Actor, f: AuditFilters = {}) {
  requirePermission(actor, "audit.view");
  const where: Prisma.AuditLogWhereInput = {};
  if (f.action) where.action = f.action;
  if (f.entityType) where.entityType = f.entityType;
  const range: Prisma.DateTimeFilter = {};
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) range.gte = new Date(`${f.from}T00:00:00.000Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) range.lte = new Date(`${f.to}T23:59:59.999Z`);
  if (range.gte || range.lte) where.createdAt = range;
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    where.OR = [
      { entityId: q },
      { action: { contains: q, mode: "insensitive" } },
      { actor: { is: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } },
    ];
  }
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const [total, rows, actions, entityTypes] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE, include: { actor: { select: { name: true, email: true, role: true } } } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);
  return { rows, total, page, pageSize: AUDIT_PAGE_SIZE, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)), actions: actions.map((a) => a.action), entityTypes: entityTypes.map((e) => e.entityType) };
}
