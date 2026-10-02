import "server-only";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { getPrivateStorage } from "./private-documents";

/**
 * Package marketing images are non-sensitive, but they live in the same (private) Blob store as
 * applicant documents so only ONE store/token is needed. They are served through the public
 * route /api/package-images/[name], which can only ever read the `package-images/` prefix, so
 * it can never expose an applicant document. Applicant documents use their own authorised route.
 */
const MAX_BYTES = 4 * 1024 * 1024; // Vercel serverless request bodies are capped at ~4.5MB
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
};
const CONTENT_TYPE_BY_EXT: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export const PACKAGE_IMAGE_ROUTE = "/api/package-images";

export async function storePackageImage(file: File): Promise<string> {
  const spec = TYPES[file.type];
  if (!spec) throw new AppError("Upload a JPG, PNG or WebP image.", "VALIDATION", { image: ["Unsupported image type"] });
  if (file.size > MAX_BYTES) throw new AppError("Images must be 4MB or smaller.", "VALIDATION", { image: ["Image is too large"] });
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!spec.magic(bytes)) throw new AppError("That file doesn't look like a valid image.", "VALIDATION", { image: ["Invalid image file"] });

  const name = `${randomUUID()}.${spec.ext}`; // never trust the client's filename
  try {
    await getPrivateStorage().put(`package-images/${name}`, bytes, CONTENT_TYPE_BY_EXT[spec.ext]!);
  } catch (error) {
    console.error("[package image upload] storage write failed:", error);
    const reason = error instanceof Error ? error.message.replace(/^Vercel Blob:\s*/i, "") : "unknown error";
    throw new AppError(`The image could not be stored (${reason}).`, "VALIDATION", { image: [reason] });
  }
  return `${PACKAGE_IMAGE_ROUTE}/${name}`;
}
