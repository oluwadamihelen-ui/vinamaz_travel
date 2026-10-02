import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { openDocument } from "@/lib/services/documents";

export const dynamic = "force-dynamic";

/**
 * Authorised document download. This is the ONLY way applicant documents leave storage:
 * the caller must be signed in and either own the application or hold documents.view.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const actor = await getActor();
    const { doc, object } = await openDocument(actor, id);
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    const filename = encodeURIComponent(doc.originalFilename);
    return new Response(object.stream, {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(object.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    if (e instanceof AppError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 404;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[document download]", e);
    return NextResponse.json({ error: "We couldn't retrieve that file. Please try again later." }, { status: 500 });
  }
}
