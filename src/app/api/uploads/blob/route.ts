import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getActor } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http-errors";
import { AppError } from "@/lib/errors";
import { privateBlobToken } from "@/lib/storage/private-documents";
import { authorizeBlobUpload } from "@/lib/services/uploads";

export const dynamic = "force-dynamic";

/**
 * Issues a short-lived Vercel Blob client token for ONE server-authorised slot: the exact private key the
 * server chose, the size cap it chose, PDF/JPG/PNG only, no overwrite. The browser can't pick a different
 * path or exceed the cap, and the stored file is re-validated when the upload is completed.
 */
export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    const token = privateBlobToken();
    if (!token) throw new AppError("File storage isn't configured.", "VALIDATION");
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      token, request, body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const slot = await authorizeBlobUpload(actor, String(clientPayload ?? ""), pathname);
        return {
          allowedContentTypes: ["application/pdf", "image/jpeg", "image/png"],
          maximumSizeInBytes: slot.maxBytes, validUntil: slot.validUntil, addRandomSuffix: false, allowOverwrite: false,
        };
      },
      // Completion is driven by the browser calling /api/uploads/:id/complete (no public callback needed).
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, "blob token", "We couldn't start your upload. Please try again.");
  }
}
