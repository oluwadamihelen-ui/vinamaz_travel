import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { MAX_SERVER_UPLOAD_BYTES } from "@/lib/applications/files";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { openPaymentProof, submitTransferProof } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

const statusOf = (e: AppError) => (e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : e.code === "CONFLICT" ? 409 : 400);

/** Authorised view/download of a bank-transfer proof (owner or staff with payments.view). */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { object, payment } = await openPaymentProof(await getActor(), (await ctx.params).id);
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new Response(object.stream, {
      headers: {
        "Content-Type": payment.proofMimeType ?? object.contentType, "Content-Length": String(object.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(payment.proofFilename ?? "proof")}`,
        "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: statusOf(e) });
    console.error("[payment proof]", e);
    return NextResponse.json({ error: "We couldn't retrieve that file." }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
    if (!rateLimit(`proof:${actor.id}`, 20, 10 * 60_000).ok) return NextResponse.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_SERVER_UPLOAD_BYTES + 64 * 1024) return NextResponse.json({ error: "That file is too large." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Please choose your transfer receipt." }, { status: 400 });
    await submitTransferProof(actor, (await ctx.params).id, {
      filename: file.name, bytes: Buffer.from(await file.arrayBuffer()),
      senderName: String(form.get("senderName") ?? ""), transferDate: String(form.get("transferDate") ?? ""),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message, fieldErrors: e.fieldErrors }, { status: statusOf(e) });
    console.error("[payment proof upload]", e);
    return NextResponse.json({ error: "Your upload failed. Please try again." }, { status: 500 });
  }
}
