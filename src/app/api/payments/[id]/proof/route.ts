import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { openPaymentProof } from "@/lib/services/payments";

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
