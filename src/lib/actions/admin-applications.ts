"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import {
  addApplicationNote, assignApplication, changeApplicationStatus, reviewDocument, type ReviewAction,
} from "@/lib/services/admin-applications";
import { createStaffAccount, INVITE_HOURS, resendStaffInvite, updateStaffAccount } from "@/lib/services/staff";
import { APPLICATION_STATUSES } from "@/lib/applications/labels";
import type { ApplicationStatus } from "@/generated/prisma/enums";

export interface AdminActionState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  message?: string;
}

async function run(fn: (actor: NonNullable<Awaited<ReturnType<typeof getActor>>>) => Promise<string | void>, paths: string[]): Promise<AdminActionState> {
  try {
    const actor = await getActor();
    if (!actor) return { error: "Please sign in to continue." };
    const message = await fn(actor);
    for (const p of paths) revalidatePath(p);
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors };
    console.error("[admin action]", e);
    return { error: "Something went wrong. Please try again." };
  }
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export async function changeStatusAction(applicationId: string, _prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const to = str(formData.get("to")) as ApplicationStatus;
  return run(async (actor) => {
    if (!(APPLICATION_STATUSES as readonly string[]).includes(to)) throw new AppError("Choose a status.", "VALIDATION", { to: ["Required"] });
    await changeApplicationStatus(actor, applicationId, { to, note: str(formData.get("note")), override: formData.get("override") === "on" });
    return "Status updated.";
  }, [`/admin/applications/${applicationId}`, "/admin/applications"]);
}

export async function assignAction(applicationId: string, _prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const staffId = str(formData.get("staffId"));
  return run(async (actor) => {
    await assignApplication(actor, applicationId, staffId || null);
    return staffId ? "Assigned." : "Unassigned.";
  }, [`/admin/applications/${applicationId}`, "/admin/applications"]);
}

export async function addNoteAction(applicationId: string, _prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return run(async (actor) => {
    await addApplicationNote(actor, applicationId, str(formData.get("body")));
    return "Note added.";
  }, [`/admin/applications/${applicationId}`]);
}

export async function reviewDocumentAction(applicationId: string, documentId: string, action: ReviewAction, _prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return run(async (actor) => {
    await reviewDocument(actor, documentId, { action, reason: str(formData.get("reason")) });
    return "Document updated.";
  }, [`/admin/applications/${applicationId}`]);
}

export async function createStaffAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return run(async (actor) => {
    const role = str(formData.get("role")) === "ADMIN" ? "ADMIN" : "STAFF";
    const res = await createStaffAccount(actor, {
      name: str(formData.get("name")), email: str(formData.get("email")), role,
      permissions: formData.getAll("permissions").filter((v): v is string => typeof v === "string"),
    });
    return res.inviteEmailSent ? "Account created and invitation emailed." : `Account created, but the invitation email could not be sent. Give them this one-time link (valid ${INVITE_HOURS} hours): ${res.inviteLink}`;
  }, ["/admin/staff"]);
}

export async function resendInviteAction(userId: string): Promise<AdminActionState> {
  return run(async (actor) => {
    const res = await resendStaffInvite(actor, userId);
    return res.inviteEmailSent ? "Invitation sent again." : `The email could not be sent. Give them this one-time link (valid ${INVITE_HOURS} hours): ${res.inviteLink}`;
  }, ["/admin/staff"]);
}

export async function updateStaffAction(userId: string, _prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  return run(async (actor) => {
    await updateStaffAccount(actor, userId, {
      permissions: formData.getAll("permissions").filter((v): v is string => typeof v === "string"),
      isActive: formData.get("isActive") === "on",
    });
    return "Saved.";
  }, ["/admin/staff"]);
}
