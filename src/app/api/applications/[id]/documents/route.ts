import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { MAX_SERVER_UPLOAD_BYTES } from "@/lib/applications/files";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { uploadDocument } from "@/lib/services/documents";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    if (!(await rateLimit(`upload:${actor.id}`, 60, 10 * 60 * 1000)).ok) {
      return NextResponse.json({ error: "Too many uploads. Please wait a few minutes and try again." }, { status: 429 });
    }
    // Reject oversized bodies before buffering them.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_SERVER_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "That file is too large." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    const requirementKey = form.get("requirementKey");
    if (!(file instanceof File) || typeof requirementKey !== "string") {
      return NextResponse.json({ error: "Please choose a file to upload." }, { status: 400 });
    }
    const doc = await uploadDocument(actor, {
      applicationId: id, requirementKey, filename: file.name, bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ ok: true, document: { id: doc.id, status: doc.status } });
  } catch (e) {
    if (e instanceof AppError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[document upload]", e);
    return NextResponse.json({ error: "Your document upload failed. Please try again." }, { status: 500 });
  }
}
