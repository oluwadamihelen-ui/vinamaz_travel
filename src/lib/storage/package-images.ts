import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { AppError } from "@/lib/errors";

/**
 * Package marketing images are PUBLIC, non-sensitive assets (stored in Vercel Blob with
 * public access). This module must never be used for applicant documents — those use
 * private storage with authorised access (Phase 2).
 */
// Vercel serverless request bodies are capped at ~4.5MB, so keep images safely under that.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
};

export async function storePackageImage(file: File): Promise<string> {
  const spec = TYPES[file.type];
  if (!spec) throw new AppError("Upload a JPG, PNG or WebP image.", "VALIDATION", { image: ["Unsupported image type"] });
  if (file.size > MAX_BYTES) throw new AppError("Images must be 4MB or smaller.", "VALIDATION", { image: ["Image is too large"] });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!spec.magic(bytes)) throw new AppError("That file doesn't look like a valid image.", "VALIDATION", { image: ["Invalid image file"] });

  const name = `${randomUUID()}.${spec.ext}`; // never trust the client's filename

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await put(`package-images/${name}`, bytes, { access: "public", contentType: file.type });
      return blob.url;
    } catch (error) {
      console.error("[package image upload] Vercel Blob put failed:", error);
      const reason = error instanceof Error ? error.message.replace(/^Vercel Blob:\s*/i, "") : "unknown error";
      throw new AppError(
        `The image could not be stored (${reason}). Check that BLOB_READ_WRITE_TOKEN belongs to a PUBLIC Vercel Blob store.`,
        "VALIDATION",
        { image: [reason] },
      );
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new AppError("Image storage is not configured. Please contact support.", "VALIDATION");
  }
  // Local development fallback only (public marketing images, not applicant documents).
  const dir = path.join(process.cwd(), "public", "package-images");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return `/package-images/${name}`;
}
