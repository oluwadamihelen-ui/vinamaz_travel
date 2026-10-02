import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { MAX_UPLOAD_BYTES } from "@/lib/applications/files";
import { errorResponse } from "@/lib/http-errors";
import { receiveDirectUpload } from "@/lib/services/uploads";

export const dynamic = "force-dynamic";

/** Local development / tests only: bytes for a slot arrive here. In production the browser uploads straight to Vercel Blob. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 1024) return NextResponse.json({ error: "That file is too large." }, { status: 413 });
    await receiveDirectUpload(actor, (await ctx.params).id, Buffer.from(await request.arrayBuffer()));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, "direct upload", "Your upload failed. Please try again.");
  }
}
