import { randomUUID } from "node:crypto";

/**
 * Upload validation. Server-side only: type is decided by file CONTENT (magic bytes), not the
 * client-supplied MIME type or extension.
 */
/** Files go browser -> private storage directly, so the old ~4.5MB serverless body cap no longer applies. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Kept for the in-memory path (tests, local direct mode). */
export const MAX_SERVER_UPLOAD_BYTES = MAX_UPLOAD_BYTES;

export type DocFormat = "pdf" | "jpg" | "png";

export function sniffFormat(b: Buffer): DocFormat | null {
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  return null;
}

export const MIME_BY_FORMAT: Record<DocFormat, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };

/** Strip paths and control/unsafe characters; keep it short. Used for display & download names only. */
export function safeFilename(name: string, format: DocFormat): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const stem = base
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${stem || "document"}.${format}`;
}

export function newMessageAttachmentKey(applicationId: string, format: DocFormat): string {
  return `messages/${applicationId}/${randomUUID()}.${format}`;
}

export function newStorageKey(applicationId: string, format: DocFormat): string {
  return `applications/${applicationId}/${randomUUID()}.${format}`;
}

/** Effective size cap in bytes for a requirement: configured limit, never above the server limit. */
export function effectiveMaxBytes(configuredMb: number): number {
  return Math.min(configuredMb * 1024 * 1024, MAX_UPLOAD_BYTES);
}
