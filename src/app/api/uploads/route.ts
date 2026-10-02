import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http-errors";
import { initUpload } from "@/lib/services/uploads";

export const dynamic = "force-dynamic";

/** Step 1: ask for an upload slot. The server decides the storage key and limits. */
export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.filename !== "string" || typeof body.size !== "number") throw new AppError("Please choose a file to upload.", "VALIDATION");
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const result = await initUpload(actor, {
      kind: body.kind as never, applicationId: str(body.applicationId), paymentId: str(body.paymentId), requirementKey: str(body.requirementKey), filename: body.filename, size: body.size,
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e, "upload init", "We couldn't start your upload. Please try again.");
  }
}
