import type { Role } from "@/generated/prisma/enums";

/** Every permission key in the system. Add new keys here as features land. */
export const PERMISSIONS = [
  "packages.view",
  "packages.manage",
  "applications.view",
  "applications.manage",
  "applications.assign",
  "applications.status_update",
  "documents.view",
  "documents.review",
  "payments.view",
  "payments.manage",
  "payments.refund",
  "clients.view",
  "clients.manage",
  "messages.view",
  "messages.manage",
  "notifications.view",
  "notifications.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/** ADMIN: operational access, but not refunds, settings or audit review. */
const ADMIN_PERMISSIONS: readonly Permission[] = ALL.filter(
  (p) => !["payments.refund", "settings.manage", "audit.view"].includes(p),
);

/**
 * Default permissions per role. STAFF intentionally has none: staff only get what an
 * administrator grants them individually (User.permissions). CLIENT never gets
 * staff permissions; client access is ownership-based, not permission-based.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  CLIENT: [],
  STAFF: [],
  ADMIN: ADMIN_PERMISSIONS,
  SUPER_ADMIN: ALL,
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export interface PermissionSubject {
  role: Role;
  permissions: readonly string[];
}

/** Effective permission set for a user. Unknown keys and CLIENT grants are ignored. */
export function effectivePermissions(subject: PermissionSubject): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[subject.role]);
  if (subject.role !== "CLIENT") {
    for (const p of subject.permissions) if (isPermission(p)) set.add(p);
  }
  return set;
}

export function can(subject: PermissionSubject, permission: Permission): boolean {
  if (subject.role === "SUPER_ADMIN") return true;
  return effectivePermissions(subject).has(permission);
}

export function isStaffRole(role: Role): boolean {
  return role !== "CLIENT";
}
