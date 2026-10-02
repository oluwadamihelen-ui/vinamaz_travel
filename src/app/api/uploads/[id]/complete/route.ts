import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http-errors";
import { completeUpload } from "@/lib/services/uploads";

export const dynamic = "force-dynamic";

/** Step 3: the file is in storage; the server re-validates it and attaches it. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await completeUpload(actor, (await ctx.params).id, {
      senderName: typeof body.senderName === "string" ? body.senderName : undefined, transferDate: typeof body.transferDate === "string" ? body.transferDate : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e, "upload complete", "We couldn't finish your upload. Please try again.");
  }
}
