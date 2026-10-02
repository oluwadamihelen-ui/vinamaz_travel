import { NextResponse } from "next/server";
import { PACKAGE_IMAGE_KEY_RE, getPrivateStorage } from "@/lib/storage/private-documents";

/**
 * Public route for package artwork. The key is rebuilt from a strictly validated file name under
 * the fixed `package-images/` prefix, so this route cannot be used to read applicant documents.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const key = `package-images/${name}`;
  if (!PACKAGE_IMAGE_KEY_RE.test(key)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const object = await getPrivateStorage().get(key);
    if (!object || !object.contentType.startsWith("image/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new Response(object.stream, {
      headers: {
        "Content-Type": object.contentType,
        "Content-Length": String(object.size),
        // File names are random UUIDs and never reused, so the content is immutable.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    console.error("[package image]", e);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
