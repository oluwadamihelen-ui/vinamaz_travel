import { getActor } from "@/lib/auth/session";
import { errorResponse } from "@/lib/http-errors";
import { openMessageAttachment } from "@/lib/services/messages";

export const dynamic = "force-dynamic";

/** Authorised download of a message attachment: conversation participants only. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { att, object } = await openMessageAttachment(await getActor(), (await ctx.params).id);
    const inline = new URL(request.url).searchParams.get("inline") === "1";
    return new Response(object.stream, {
      headers: {
        "Content-Type": att.mimeType, "Content-Length": String(object.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
        "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return errorResponse(e, "message attachment", "We couldn't retrieve that file.");
  }
}
