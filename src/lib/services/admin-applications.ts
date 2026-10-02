import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ApplicationStatus, DocumentStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Actor } from "@/lib/auth/actor";
import { can, type Permission } from "@/lib/auth/permissions";
import { buildSteps, computeProgress, documentSlots } from "@/lib/applications/engine";
import { STATUS_LABEL } from "@/lib/applications/labels";
import { canTransition, STATUS_TRANSITIONS } from "@/lib/applications/status";
import { recordAudit } from "./audit";
import { onDocumentReplacementRequested, onStatusChanged } from "./events";
import { loadApplicationConfig } from "./applications";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Scope: who may see which applications
// ---------------------------------------------------------------------------

/** ADMIN and SUPER_ADMIN see every application; STAFF only the ones assigned to them. */
export function canViewAllApplications(actor: Actor): boolean {
  return actor.role === "ADMIN" || actor.role === "SUPER_ADMIN";
}

export function applicationScope(actor: Actor): Prisma.VisaApplicationWhereInput {
  return canViewAllApplications(actor) ? {} : { assignedToId: actor.id };
}

/**
 * Load an application the actor is allowed to manage. Requires `permission` AND that the
 * application is inside the actor's scope; out-of-scope ids look exactly like missing ones.
 */
export async function getManagedApplication(actor: Actor, id: string, permission: Permission = "applications.view", client: Tx | typeof db = db) {
  requirePermission(actor, permission);
  if (actor.role === "CLIENT") throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  const app = await client.visaApplication.findFirst({ where: { id, ...applicationScope(actor) } });
  if (!app) throw new AppError("We couldn't find that application.", "NOT_FOUND");
  return app;
}

// ---------------------------------------------------------------------------
// List (filters, search, pagination)
// ---------------------------------------------------------------------------

export interface ApplicationFilters {
  q?: string;
  country?: string;
  packageId?: string;
  status?: ApplicationStatus;
  /** "unassigned", "me", or a staff user id. */
  assignee?: string;
  from?: string; // YYYY-MM-DD (created on/after)
  to?: string; // YYYY-MM-DD (created on/before)
  page?: number;
  pageSize?: number;
}

export async function listAdminApplications(actor: Actor, f: ApplicationFilters = {}) {
  requirePermission(actor, "applications.view");
  const and: Prisma.VisaApplicationWhereInput[] = [applicationScope(actor)];
  const q = f.q?.trim();
  if (q) {
    and.push({
      OR: [
        { applicationNumber: { contains: q, mode: "insensitive" } },
        { client: { name: { contains: q, mode: "insensitive" } } },
        { client: { email: { contains: q, mode: "insensitive" } } },
        { client: { phone: { contains: q } } },
      ],
    });
  }
  if (f.country) and.push({ packageCountry: f.country });
  if (f.packageId) and.push({ packageId: f.packageId });
  if (f.status) and.push({ status: f.status });
  if (f.assignee === "unassigned") and.push({ assignedToId: null });
  else if (f.assignee === "me") and.push({ assignedToId: actor.id });
  else if (f.assignee) and.push({ assignedToId: f.assignee });
  const created: Prisma.DateTimeFilter = {};
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) created.gte = new Date(`${f.from}T00:00:00.000Z`);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) created.lte = new Date(`${f.to}T23:59:59.999Z`);
  if (created.gte || created.lte) and.push({ createdAt: created });

  const where: Prisma.VisaApplicationWhereInput = { AND: and };
  const pageSize = Math.min(Math.max(f.pageSize ?? 20, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const [items, total] = await Promise.all([
    db.visaApplication.findMany({
      where, orderBy: { updatedAt: "desc" }, take: pageSize, skip: (page - 1) * pageSize,
      select: {
        id: true, applicationNumber: true, packageName: true, packageCountry: true, status: true, progressPercent: true,
        createdAt: true, updatedAt: true, submittedAt: true,
        client: { select: { id: true, name: true, email: true, phone: true } },
        assignedTo: { select: { id: true, name: true } },
        payments: { where: { kind: "APPLICATION" }, select: { status: true }, take: 1 },
      },
    }),
    db.visaApplication.count({ where }),
  ]);
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Choices for the filter bar. Countries are limited to what the actor can actually see. */
export async function getApplicationFilterOptions(actor: Actor) {
  requirePermission(actor, "applications.view");
  const [countries, packages, staff] = await Promise.all([
    db.visaApplication.findMany({ where: applicationScope(actor), distinct: ["packageCountry"], select: { packageCountry: true }, orderBy: { packageCountry: "asc" } }),
    db.travelPackage.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    canViewAllApplications(actor) ? listAssignableStaff(actor) : Promise.resolve([]),
  ]);
  return { countries: countries.map((c) => c.packageCountry), packages, staff };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getAdminApplicationView(actor: Actor, id: string) {
  const app = await getManagedApplication(actor, id, "applications.view");
  const canSeeDocs = can(actor, "documents.view");
  const [config, answerRows, documents, history, notes, client] = await Promise.all([
    loadApplicationConfig(app),
    db.applicationAnswer.findMany({ where: { applicationId: app.id } }),
    canSeeDocs ? db.applicationDocument.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    db.applicationStatusHistory.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } }),
    db.applicationNote.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }),
    db.user.findUniqueOrThrow({ where: { id: app.clientId }, select: { id: true, name: true, email: true, phone: true, createdAt: true, clientProfile: true } }),
  ]);
  const answers: Record<string, never> = Object.fromEntries(answerRows.map((r) => [r.questionKey, r.value])) as Record<string, never>;
  const slots = documentSlots(config.docReqs, config.questions, answers);
  const steps = buildSteps(config.questions, slots.length > 0);
  const currentDocs = documents.filter((d) => d.isCurrent);
  const progress = computeProgress({
    applicant: app.applicant as Record<string, unknown>, questions: config.questions, answers, slots,
    uploadedSlotKeys: new Set(currentDocs.map((d) => d.requirementKey)),
  });
  // uploadedById / reviewedById / changedById are plain ids (history survives user removal), so resolve names here.
  const nameIds = new Set<string>();
  for (const d of documents) { if (d.uploadedById) nameIds.add(d.uploadedById); if (d.reviewedById) nameIds.add(d.reviewedById); }
  for (const h of history) if (h.changedById) nameIds.add(h.changedById);
  const nameRows = nameIds.size ? await db.user.findMany({ where: { id: { in: [...nameIds] } }, select: { id: true, name: true } }) : [];
  const names = new Map(nameRows.map((u) => [u.id, u.name]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "Former user") : null);
  const assignedTo = app.assignedToId ? await db.user.findUnique({ where: { id: app.assignedToId }, select: { id: true, name: true } }) : null;
  const allowedNext = STATUS_TRANSITIONS[app.status];
  const staff = can(actor, "applications.assign") ? await listAssignableStaff(actor) : [];
  return {
    app, client, config, answers, slots, steps, progress, nameOf,
    documents: documents.map((d) => ({ ...d, uploadedByName: nameOf(d.uploadedById), reviewedByName: nameOf(d.reviewedById) })),
    currentDocs: currentDocs.map((d) => ({ ...d, uploadedByName: nameOf(d.uploadedById), reviewedByName: nameOf(d.reviewedById) })),
    history: history.map((h) => ({ ...h, changedByName: nameOf(h.changedById) })),
    notes, assignedTo, allowedNext, staff,
    permissions: {
      statusUpdate: can(actor, "applications.status_update"),
      assign: can(actor, "applications.assign"),
      reviewDocs: can(actor, "documents.review"),
      viewDocs: canSeeDocs,
      addNotes: can(actor, "applications.manage"),
      overrideTerminal: actor.role === "SUPER_ADMIN",
    },
  };
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ApplicationStatus[] = ["COMPLETED", "CANCELLED"];

export interface StatusChangeInput {
  to: ApplicationStatus;
  /** Message the client will see on their timeline (optional for normal transitions). */
  note?: string;
  /** Required to move outside the normal workflow; needs a note. */
  override?: boolean;
}

export async function changeApplicationStatus(actor: Actor, id: string, input: StatusChangeInput) {
  const app = await getManagedApplication(actor, id, "applications.status_update");
  const from = app.status;
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new AppError("The message is too long (maximum 1000 characters).", "VALIDATION", { note: ["Too long"] });
  if (!(input.to in STATUS_TRANSITIONS)) throw new AppError("Choose a valid status.", "VALIDATION", { to: ["Invalid status"] });
  if (input.to === from) throw new AppError("The application is already in that status.", "VALIDATION", { to: ["No change"] });

  // Drafts belong to the client: only the client submits them (the form is validated then). Staff may only cancel one.
  if ((from === "DRAFT" && input.to !== "CANCELLED") || input.to === "DRAFT") {
    throw new AppError("Draft applications belong to the client and can't be moved by staff (other than cancelling).", "FORBIDDEN");
  }

  const normal = canTransition(from, input.to);
  if (!normal) {
    if (!input.override) {
      throw new AppError(`Moving from "${STATUS_LABEL[from]}" to "${STATUS_LABEL[input.to]}" isn't part of the normal workflow. Tick "override" and explain why.`, "VALIDATION", { to: ["Not a normal transition"] });
    }
    if (!note || note.length < 5) throw new AppError("An override needs an explanation for the record.", "VALIDATION", { note: ["Add a reason (at least 5 characters)"] });
    if (TERMINAL_STATUSES.includes(from) && actor.role !== "SUPER_ADMIN") throw new AppError("Only a super admin can reopen a completed or cancelled application.", "FORBIDDEN");
  }

  await db.$transaction(async (tx) => {
    // Compare-and-set: if someone else changed the status meanwhile, don't silently overwrite it.
    const res = await tx.visaApplication.updateMany({ where: { id: app.id, status: from }, data: { status: input.to } });
    if (res.count !== 1) throw new AppError("This application was just updated by someone else. Please refresh and try again.", "CONFLICT");
    await tx.applicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: from, toStatus: input.to, changedById: actor.id, note, isOverride: !normal } });
  });
  await recordAudit({
    actorId: actor.id, action: "application.status_changed", entityType: "VisaApplication", entityId: app.id,
    metadata: { applicationNumber: app.applicationNumber, from, to: input.to, override: !normal },
  });
  await onStatusChanged(app.id, input.to, note);
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/** Active staff who could be given an application: they must be able to view applications. */
export async function listAssignableStaff(actor: Actor) {
  requirePermission(actor, "applications.view");
  const users = await db.user.findMany({
    where: { isActive: true, role: { in: ["STAFF", "ADMIN", "SUPER_ADMIN"] } },
    select: { id: true, name: true, email: true, role: true, permissions: true },
    orderBy: { name: "asc" },
  });
  return users.filter((u) => can(u, "applications.view")).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
}

export async function assignApplication(actor: Actor, id: string, staffId: string | null) {
  const app = await getManagedApplication(actor, id, "applications.assign");
  if (staffId) {
    const staff = await db.user.findUnique({ where: { id: staffId }, select: { id: true, role: true, permissions: true, isActive: true } });
    if (!staff || !staff.isActive || staff.role === "CLIENT" || !can(staff, "applications.view")) {
      throw new AppError("That person can't be assigned applications.", "VALIDATION", { staffId: ["Choose an active staff member who can view applications"] });
    }
  }
  if (app.assignedToId === staffId) return;
  await db.visaApplication.update({ where: { id: app.id }, data: { assignedToId: staffId, assignedAt: staffId ? new Date() : null } });
  await recordAudit({
    actorId: actor.id, action: "application.assigned", entityType: "VisaApplication", entityId: app.id,
    metadata: { applicationNumber: app.applicationNumber, from: app.assignedToId, to: staffId },
  });
}

// ---------------------------------------------------------------------------
// Internal notes (never visible to clients)
// ---------------------------------------------------------------------------

export async function addApplicationNote(actor: Actor, id: string, rawBody: string) {
  const app = await getManagedApplication(actor, id, "applications.manage");
  const body = rawBody.trim();
  if (!body) throw new AppError("Write a note first.", "VALIDATION", { body: ["Required"] });
  if (body.length > 5000) throw new AppError("That note is too long (maximum 5000 characters).", "VALIDATION", { body: ["Too long"] });
  return db.applicationNote.create({ data: { applicationId: app.id, authorId: actor.id, body } });
}

// ---------------------------------------------------------------------------
// Document review
// ---------------------------------------------------------------------------

export type ReviewAction = "start_review" | "approve" | "request_replacement" | "reject";

const REVIEW_RESULT: Record<ReviewAction, DocumentStatus> = {
  start_review: "UNDER_REVIEW", approve: "APPROVED", request_replacement: "REPLACEMENT_REQUIRED", reject: "REJECTED",
};
const AUDIT_ACTION: Record<ReviewAction, string> = {
  start_review: "document.review_started", approve: "document.approved", request_replacement: "document.replacement_requested", reject: "document.rejected",
};

export async function reviewDocument(actor: Actor, documentId: string, input: { action: ReviewAction; reason?: string }) {
  requirePermission(actor, "documents.review");
  const doc = await db.applicationDocument.findUnique({ where: { id: documentId } });
  // Scope check goes through the application, so STAFF can only review documents of applications assigned to them.
  if (!doc) throw new AppError("We couldn't find that document.", "NOT_FOUND");
  const app = await getManagedApplication(actor, doc.applicationId, "documents.review");
  if (!doc.isCurrent) throw new AppError("That is an older version of the document; review the latest upload.", "VALIDATION");

  const reason = input.reason?.trim() || null;
  const needsReason = input.action === "request_replacement" || input.action === "reject";
  if (needsReason && (!reason || reason.length < 3)) throw new AppError("Tell the client what's wrong so they can fix it.", "VALIDATION", { reason: ["A reason is required"] });
  if (reason && reason.length > 500) throw new AppError("The reason is too long (maximum 500 characters).", "VALIDATION", { reason: ["Too long"] });

  const next = REVIEW_RESULT[input.action];
  if (doc.status === next) throw new AppError("The document is already in that status.", "VALIDATION");

  await db.$transaction(async (tx) => {
    const res = await tx.applicationDocument.updateMany({
      where: { id: doc.id, isCurrent: true, status: doc.status },
      data: { status: next, rejectionReason: needsReason ? reason : null, reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (res.count !== 1) throw new AppError("This document was just updated. Please refresh and try again.", "CONFLICT");

    // Asking for a replacement while we're in review puts the ball in the client's court.
    if (needsReason && (app.status === "UNDER_REVIEW" || app.status === "DOCUMENTS_UNDER_REVIEW")) {
      const moved = await tx.visaApplication.updateMany({ where: { id: app.id, status: app.status }, data: { status: "DOCUMENTS_REQUIRED" } });
      if (moved.count === 1) {
        await tx.applicationStatusHistory.create({
          data: { applicationId: app.id, fromStatus: app.status, toStatus: "DOCUMENTS_REQUIRED", changedById: actor.id, note: `${doc.name}: ${reason}` },
        });
      }
    }
  });
  await recordAudit({
    actorId: actor.id, action: AUDIT_ACTION[input.action], entityType: "ApplicationDocument", entityId: doc.id,
    metadata: { applicationId: app.id, applicationNumber: app.applicationNumber, requirementKey: doc.requirementKey, reason },
  });
  if (needsReason) await onDocumentReplacementRequested(app.id, doc.name, reason, input.action === "request_replacement");
}
