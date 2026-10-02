import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loadActor } from "@/lib/services/users";
import type { Actor } from "./actor";
import { can, isStaffRole, type Permission } from "./permissions";

/** Current DB-verified actor, or null. Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return loadActor(id, session.issuedAt);
});

export async function requireActorPage(next?: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return actor;
}

export async function requireClientPage(): Promise<Actor> {
  const actor = await requireActorPage("/client/dashboard");
  if (actor.role !== "CLIENT") redirect("/admin");
  return actor;
}

/** For /admin pages: must be staff, and (optionally) hold a specific permission. */
export async function requireStaffPage(permission?: Permission): Promise<Actor> {
  const actor = await requireActorPage("/admin");
  if (!isStaffRole(actor.role)) redirect("/client/dashboard");
  if (permission && !can(actor, permission)) redirect("/admin?denied=1");
  return actor;
}
