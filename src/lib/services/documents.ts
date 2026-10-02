import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can } from "@/lib/auth/permissions";
import { requireClient, type Actor } from "@/lib/auth/actor";
import { documentSlots } from "@/lib/applications/engine";
import { MIME_BY_FORMAT, effectiveMaxBytes, newStorageKey, safeFilename, sniffFormat } from "@/lib/applications/files";
import { isTerminal } from "@/lib/applications/next-action";
import { CLIENT_UPLOAD_STATUSES } from "@/lib/applications/status";
import { getPrivateStorage } from "@/lib/storage/private-documents";
import { recordAudit } from "./audit";
import { getOwnedApplication, loadPackageConfig, recomputeProgress } from "./applications";

export interface UploadInput {
  applicationId: string;
  /** Untrusted: validated against the package's configured document slots. */
  requirementKey: string;
  filename: string;
  bytes: Buffer;
}

/**
 * Upload (or replace) a document for an application the actor owns.
 * Replacement never deletes history: the previous row stays (isCurrent=false) and the new
 * row points at it via replacesId.
 */
export async function uploadDocument(actor: Actor, input: UploadInput) {
  const app = await getOwnedApplication(actor, input.applicationId);
  const previous = await db.applicationDocument.findFirst({ where: { applicationId: app.id, requirementKey: input.requirementKey, isCurrent: true } });
  // Uploads are open in draft / "documents required" states, and a document staff asked to be replaced
  // can always be replaced (unless the application is finished).
  const replacementRequested = previous?.status === "REJECTED" || previous?.status === "REPLACEMENT_REQUIRED";
  if (!CLIENT_UPLOAD_STATUSES.includes(app.status) && !(replacementRequested && !isTerminal(app.status))) {
    throw new AppError("Documents can't be changed for this application right now.", "FORBIDDEN");
  }

  const config = await loadPackageConfig(app.packageId);
  const answerRows = await db.applicationAnswer.findMany({ where: { applicationId: app.id } });
  const answers = Object.fromEntries(answerRows.map((r) => [r.questionKey, r.value])) as Parameters<typeof documentSlots>[2];
  const slot = documentSlots(config.docReqs, config.questions, answers).find((s) => s.key === input.requirementKey);
  if (!slot) throw new AppError("That document is not part of this application.", "VALIDATION");

  if (input.bytes.length === 0) throw new AppError("That file is empty. Please choose another file.", "VALIDATION");
  if (input.bytes.length > effectiveMaxBytes(slot.maxSizeMb)) {
    const mb = Math.floor(effectiveMaxBytes(slot.maxSizeMb) / (1024 * 1024));
    throw new AppError(`That file is too large. The maximum size is ${mb}MB.`, "VALIDATION");
  }
  const format = sniffFormat(input.bytes);
  if (!format || !slot.acceptedFormats.includes(format)) {
    throw new AppError(`Unsupported file type. Accepted formats: ${slot.acceptedFormats.map((f) => f.toUpperCase()).join(", ")}.`, "VALIDATION");
  }

  if (previous?.status === "APPROVED") {
    throw new AppError("This document has already been approved and can't be replaced.", "FORBIDDEN");
  }

  const storageKey = newStorageKey(app.id, format);
  const storage = getPrivateStorage();
  await storage.put(storageKey, input.bytes, MIME_BY_FORMAT[format]);

  try {
    const created = await db.$transaction(async (tx) => {
      if (previous) {
        // Compare-and-set so two concurrent replacements can't both claim "current".
        const res = await tx.applicationDocument.updateMany({ where: { id: previous.id, isCurrent: true }, data: { isCurrent: false } });
        if (res.count !== 1) throw new AppError("This document was just updated. Please refresh and try again.", "CONFLICT");
      }
      const doc = await tx.applicationDocument.create({
        data: {
          applicationId: app.id, requirementKey: slot.key, name: slot.name, storageKey,
          originalFilename: safeFilename(input.filename, format), mimeType: MIME_BY_FORMAT[format], sizeBytes: input.bytes.length,
          status: "UPLOADED", replacesId: previous?.id ?? null, uploadedById: actor.id,
        },
      });
      await recomputeProgress(tx, app.id, config);

      // Once every requested replacement is in, hand the application back to staff for review.
      if (app.status === "DOCUMENTS_REQUIRED") {
        const outstanding = await tx.applicationDocument.count({ where: { applicationId: app.id, isCurrent: true, status: { in: ["REJECTED", "REPLACEMENT_REQUIRED"] } } });
        if (outstanding === 0) {
          const moved = await tx.visaApplication.updateMany({ where: { id: app.id, status: "DOCUMENTS_REQUIRED" }, data: { status: "DOCUMENTS_UNDER_REVIEW" } });
          if (moved.count === 1) {
            await tx.applicationStatusHistory.create({
              data: { applicationId: app.id, fromStatus: "DOCUMENTS_REQUIRED", toStatus: "DOCUMENTS_UNDER_REVIEW", changedById: actor.id, note: "Updated documents received from client" },
            });
          }
        }
      }
      return doc;
    });
    await recordAudit({
      actorId: actor.id, action: previous ? "document.replaced" : "document.uploaded", entityType: "ApplicationDocument", entityId: created.id,
      metadata: { applicationId: app.id, requirementKey: slot.key, replaces: previous?.id ?? null },
    });
    return created;
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined); // don't leave an orphaned private file behind
    throw e;
  }
}

/**
 * Authorise and open a document for download/view.
 *  - Clients: only documents on applications they own. Anything else is NOT_FOUND (no probing).
 *  - Staff: need documents.view.
 */
export async function openDocument(actor: Actor | null, documentId: string) {
  if (!actor) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  const doc = await db.applicationDocument.findUnique({ where: { id: documentId }, include: { application: { select: { clientId: true } } } });

  if (actor.role === "CLIENT") {
    if (!doc || doc.application.clientId !== actor.id) throw new AppError("We couldn't find that document.", "NOT_FOUND");
  } else {
    if (!can(actor, "documents.view")) throw new AppError("You do not have permission to do that.", "FORBIDDEN");
    if (!doc) throw new AppError("We couldn't find that document.", "NOT_FOUND");
    await recordAudit({ actorId: actor.id, action: "document.downloaded", entityType: "ApplicationDocument", entityId: doc.id, metadata: { applicationId: doc.applicationId } });
  }

  const object = await getPrivateStorage().get(doc.storageKey);
  if (!object) throw new AppError("We couldn't retrieve that file. Please try again later.", "NOT_FOUND");
  return { doc, object };
}

/** Download names for the client: documents of an application they own. */
export async function listOwnedDocuments(actor: Actor, applicationId: string) {
  requireClient(actor);
  const app = await getOwnedApplication(actor, applicationId);
  return db.applicationDocument.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } });
}
