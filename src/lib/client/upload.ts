"use client";

import { upload as blobUpload } from "@vercel/blob/client";

export interface UploadRequest {
  kind: "DOCUMENT" | "PAYMENT_PROOF" | "MESSAGE_ATTACHMENT";
  applicationId?: string;
  paymentId?: string;
  requirementKey?: string;
  file: File;
  /** Extra fields for the completion step (e.g. transfer details for a payment proof). */
  extra?: Record<string, string>;
  onProgress?: (percent: number) => void;
}

export class UploadError extends Error {
  constructor(message: string, public readonly fieldErrors?: Record<string, string[]>) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T & { error?: string; fieldErrors?: Record<string, string[]> }> {
  try { return (await res.json()) as T & { error?: string; fieldErrors?: Record<string, string[]> }; } catch { return {} as T & { error?: string; fieldErrors?: Record<string, string[]> }; }
}

/** Downscale large phone photos before upload; PDFs and small images pass through untouched. */
export async function prepareImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png)$/.test(file.type) || file.size < 3 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function putWithProgress(url: string, file: File, onProgress?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "Your upload failed. Please try again.";
      try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch { /* ignore */ }
      reject(new UploadError(msg));
    };
    xhr.onerror = () => reject(new UploadError("Your upload failed. Please check your connection and try again."));
    xhr.send(file);
  });
}

/**
 * Upload a file in three steps: the server authorises a slot, the browser sends the bytes straight to
 * private storage, then the server re-validates and attaches the file. Resolves with the completion result.
 */
export async function uploadFile<T = Record<string, unknown>>(req: UploadRequest): Promise<T> {
  const file = await prepareImage(req.file);
  const initRes = await fetch("/api/uploads", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: req.kind, applicationId: req.applicationId, paymentId: req.paymentId, requirementKey: req.requirementKey, filename: file.name, size: file.size }),
  });
  const init = await json<{ uploadId: string; storageKey: string; mode: "blob" | "local" }>(initRes);
  if (!initRes.ok || !init.uploadId) throw new UploadError(init.error ?? "We couldn't start your upload. Please try again.");

  req.onProgress?.(0);
  try {
    if (init.mode === "blob") {
      await blobUpload(init.storageKey, file, {
        access: "private", handleUploadUrl: "/api/uploads/blob", clientPayload: init.uploadId, contentType: file.type || undefined,
        onUploadProgress: (p) => req.onProgress?.(Math.round(p.percentage)),
      });
    } else {
      await putWithProgress(`/api/uploads/${init.uploadId}`, file, req.onProgress);
    }
  } catch (e) {
    throw e instanceof UploadError ? e : new UploadError(e instanceof Error && e.message ? `Your upload failed: ${e.message}` : "Your upload failed. Please try again.");
  }
  req.onProgress?.(100);

  const doneRes = await fetch(`/api/uploads/${init.uploadId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.extra ?? {}) });
  const done = await json<T>(doneRes);
  if (!doneRes.ok) throw new UploadError(done.error ?? "We couldn't finish your upload. Please try again.", done.fieldErrors);
  return done as T;
}
