import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { UploadKind } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/auth/actor";
import {
  MAX_ATTACHMENT_BYTES, MAX_PROOF_BYTES, MIME_BY_FORMAT, newMessageAttachmentKey, newStorageKey, sniffFormat, type DocFormat,
} from "@/lib/applications/files";
import { rateLimit } from "@/lib/rate-limit";
import { getPrivateStorage, newPaymentProofKey } from "@/lib/storage/private-documents";
import { assertDocumentFormat, finalizeDocument, prepareDocumentUpload } from "./documents";
import { authoriseConversation } from "./messages";
import { finalizeProof, parseProofFields, prepareProofSubmission } from "./payments";

/**
 * Direct-to-storage uploads.
 *
 *  1. initUpload      - the server authorises the upload, chooses the storage key, size cap and expiry,
 *                       and records a PendingUpload. Nothing here comes from the browser except the
 *                       file's name/size and which slot it is for - all re-validated.
 *  2. (bytes)         - the browser sends the file straight to private storage (Vercel Blob client token
 *                       bound to that exact key, size and content types) - or, in local development,
 *                       to PUT /api/uploads/:id.
 *  3. completeUpload  - the server re-reads the stored object, checks its size and magic bytes, then
 *                       attaches it to the application / payment / message. Anything invalid is deleted.
 *
 * Nobody can attach an object the server didn't issue a slot for, and a slot is single-use.
 */

const SLOT_TTL_MS = 30 * 60_000;
const EXT_RE = /\.(pdf|jpe?g|png)$/i;

export interface InitUploadInput {
  kind: UploadKind;
  applicationId?: string;
  paymentId?: string;
  requirementKey?: string;
  filename: string;
  size: number;
}

function formatFromName(filename: string): DocFormat | null {
  const m = EXT_RE.exec(filename.trim());
  if (!m) return null;
  const e = (m[1] ?? "").toLowerCase();
  return e === "pdf" ? "pdf" : e === "png" ? "png" : "jpg";
}

const mb = (bytes: number) => Math.floor(bytes / (1024 * 1024));

export async function initUpload(actor: Actor, input: InitUploadInput) {
  if (!(await rateLimit(`upload:${actor.id}`, 60, 10 * 60_000)).ok) throw new AppError("Too many uploads. Please wait a few minutes and try again.", "VALIDATION");
  if (!Number.isInteger(input.size) || input.size <= 0) throw new AppError("That file is empty. Please choose another file.", "VALIDATION");
  const filename = String(input.filename ?? "").slice(0, 200);
  const nameFormat = formatFromName(filename);

  let key: string;
  let maxBytes: number;
  let applicationId: string;
  let paymentId: string | null = null;
  let requirementKey: string | null = null;

  if (input.kind === "DOCUMENT") {
    if (!input.applicationId || !input.requirementKey) throw new AppError("Choose which document this is.", "VALIDATION");
    const prep = await prepareDocumentUpload(actor, input.applicationId, input.requirementKey);
    assertDocumentFormat(prep, nameFormat);
    key = newStorageKey(prep.app.id, nameFormat);
    maxBytes = prep.maxBytes;
    applicationId = prep.app.id;
    requirementKey = prep.slot.key;
  } else if (input.kind === "PAYMENT_PROOF") {
    if (!input.paymentId) throw new AppError("Choose a payment.", "VALIDATION");
    const payment = await prepareProofSubmission(actor, input.paymentId);
    if (!nameFormat) throw new AppError("Unsupported file type. Upload a PDF, JPG or PNG of your transfer receipt.", "VALIDATION");
    key = newPaymentProofKey(payment.id, nameFormat);
    maxBytes = MAX_PROOF_BYTES;
    applicationId = payment.applicationId;
    paymentId = payment.id;
  } else if (input.kind === "MESSAGE_ATTACHMENT") {
    if (!input.applicationId) throw new AppError("Choose an application.", "VALIDATION");
    const app = await authoriseConversation(actor, input.applicationId, "send");
    if (!nameFormat) throw new AppError("Unsupported file type. Attach a PDF, JPG or PNG.", "VALIDATION");
    key = newMessageAttachmentKey(app.id, nameFormat);
    maxBytes = MAX_ATTACHMENT_BYTES;
    applicationId = app.id;
  } else {
    throw new AppError("Unknown upload type.", "VALIDATION");
  }
  if (input.size > maxBytes) throw new AppError(`That file is too large. The maximum size is ${mb(maxBytes)}MB.`, "VALIDATION");

  if (Math.random() < 0.05) void purgeStaleUploads().catch(() => undefined);
  const row = await db.pendingUpload.create({
    data: { kind: input.kind, userId: actor.id, applicationId, paymentId, requirementKey, storageKey: key, filename, declaredSize: input.size, maxBytes, expiresAt: new Date(Date.now() + SLOT_TTL_MS) },
  });
  return { uploadId: row.id, storageKey: key, maxBytes, mode: getPrivateStorage().mode, contentTypes: ["application/pdf", "image/jpeg", "image/png"] as string[] };
}

async function loadOpenSlot(actor: Actor, uploadId: string) {
  const row = await db.pendingUpload.findFirst({ where: { id: uploadId, userId: actor.id } });
  if (!row) throw new AppError("We couldn't find that upload.", "NOT_FOUND");
  if (row.completedAt) throw new AppError("This upload has already been used.", "CONFLICT");
  if (row.expiresAt.getTime() < Date.now()) throw new AppError("This upload expired. Please choose the file again.", "VALIDATION");
  return row;
}

/** Called by the Blob token route: may this user get an upload token for exactly this key? */
export async function authorizeBlobUpload(actor: Actor, uploadId: string, pathname: string) {
  const row = await loadOpenSlot(actor, uploadId);
  if (row.storageKey !== pathname) throw new AppError("That upload doesn't match.", "FORBIDDEN");
  return { maxBytes: row.maxBytes, validUntil: row.expiresAt.getTime() };
}

/** Local development / tests: bytes arrive at our own route instead of going straight to Blob. */
export async function receiveDirectUpload(actor: Actor, uploadId: string, bytes: Buffer) {
  const storage = getPrivateStorage();
  if (storage.mode !== "local") throw new AppError("Direct uploads are only available in local development.", "FORBIDDEN");
  const row = await loadOpenSlot(actor, uploadId);
  if (bytes.length === 0 || bytes.length > row.maxBytes) throw new AppError(`That file is too large. The maximum size is ${mb(row.maxBytes)}MB.`, "VALIDATION");
  const format = sniffFormat(bytes);
  if (!format) throw new AppError("Unsupported file type. Upload a PDF, JPG or PNG.", "VALIDATION");
  await storage.put(row.storageKey, bytes, MIME_BY_FORMAT[format]);
}

export interface CompleteExtra { senderName?: string; transferDate?: string }

export async function completeUpload(actor: Actor, uploadId: string, extra: CompleteExtra = {}) {
  const row = await loadOpenSlot(actor, uploadId);
  // Fields the user can fix are checked BEFORE the slot is consumed, so they can correct and retry.
  const proofFields = row.kind === "PAYMENT_PROOF" ? parseProofFields({ senderName: extra.senderName ?? "", transferDate: extra.transferDate ?? "" }) : null;

  const claimed = await db.pendingUpload.updateMany({ where: { id: row.id, completedAt: null }, data: { completedAt: new Date() } });
  if (claimed.count !== 1) throw new AppError("This upload has already been used.", "CONFLICT");

  const storage = getPrivateStorage();
  const discard = async () => { await storage.delete(row.storageKey).catch(() => undefined); };

  const stored = await storage.inspect(row.storageKey);
  if (!stored) {
    await db.pendingUpload.updateMany({ where: { id: row.id }, data: { completedAt: null } }); // let them retry
    throw new AppError("Your file didn't finish uploading. Please try again.", "VALIDATION");
  }
  const format = sniffFormat(stored.head);
  const keyFormat = (row.storageKey.split(".").pop() ?? "") as DocFormat;
  if (stored.size === 0 || stored.size > row.maxBytes || !format || format !== keyFormat) {
    await discard();
    throw new AppError(!format || format !== keyFormat ? "That file isn't a valid PDF, JPG or PNG." : `That file is too large. The maximum size is ${mb(row.maxBytes)}MB.`, "VALIDATION");
  }

  try {
    if (row.kind === "DOCUMENT") {
      const prep = await prepareDocumentUpload(actor, row.applicationId!, row.requirementKey!);
      assertDocumentFormat(prep, format);
      const document = await finalizeDocument(actor, prep, { storageKey: row.storageKey, filename: row.filename, format, sizeBytes: stored.size });
      return { kind: row.kind, documentId: document.id };
    }
    if (row.kind === "PAYMENT_PROOF") {
      const payment = await prepareProofSubmission(actor, row.paymentId!);
      await finalizeProof(actor, payment, { storageKey: row.storageKey, filename: row.filename, format, sizeBytes: stored.size }, proofFields!);
      return { kind: row.kind };
    }
    // Message attachment: stays pending until a message that includes it is sent.
    await authoriseConversation(actor, row.applicationId!, "send");
    await db.pendingUpload.update({ where: { id: row.id }, data: { declaredSize: stored.size } });
    return { kind: row.kind, uploadId: row.id, filename: row.filename, sizeBytes: stored.size };
  } catch (e) {
    await discard();
    throw e;
  }
}

/** Housekeeping: remove slots that were never completed (and their stray files) and old bookkeeping rows. */
export async function purgeStaleUploads() {
  const storage = getPrivateStorage();
  const abandoned = await db.pendingUpload.findMany({ where: { completedAt: null, expiresAt: { lt: new Date(Date.now() - 10 * 60_000) } }, take: 50 });
  for (const r of abandoned) {
    await storage.delete(r.storageKey).catch(() => undefined);
    await db.pendingUpload.deleteMany({ where: { id: r.id, completedAt: null } });
  }
  // Message attachments that were uploaded but never sent.
  const unsent = await db.pendingUpload.findMany({ where: { kind: "MESSAGE_ATTACHMENT", completedAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, take: 50 });
  for (const r of unsent) {
    if (await db.applicationMessageAttachment.count({ where: { storageKey: r.storageKey } })) continue;
    await storage.delete(r.storageKey).catch(() => undefined);
    await db.pendingUpload.delete({ where: { id: r.id } }).catch(() => undefined);
  }
  // Bookkeeping for documents/proofs (the files themselves are referenced elsewhere).
  await db.pendingUpload.deleteMany({ where: { kind: { in: ["DOCUMENT", "PAYMENT_PROOF"] }, completedAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } } });
}
