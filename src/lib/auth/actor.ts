import type { Role } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { can, type Permission } from "./permissions";

/** The authenticated, DB-verified user performing an action. Built only by getActor(). */
export interface Actor {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: readonly string[];
}

export function requirePermission(actor: Actor | null | undefined, permission: Permission): Actor {
  if (!actor) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  if (!can(actor, permission)) throw new AppError("You do not have permission to do that.", "FORBIDDEN");
  return actor;
}

export function requireClient(actor: Actor | null | undefined): Actor {
  if (!actor) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  if (actor.role !== "CLIENT") throw new AppError("This area is for client accounts.", "FORBIDDEN");
  return actor;
}
