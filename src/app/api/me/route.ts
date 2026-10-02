import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Tiny "who am I" hint for the public header, so public pages themselves can stay cacheable. No personal data. */
export async function GET() {
  const actor = await getActor();
  const portal = actor ? (actor.role === "CLIENT" ? "/client/dashboard" : "/admin") : null;
  return NextResponse.json({ portal }, { headers: { "Cache-Control": "private, no-store" } });
}
