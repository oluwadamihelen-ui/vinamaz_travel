import type { ApplicationStatus } from "@/generated/prisma/enums";

/**
 * Legal status transitions for the normal workflow. Not every package uses every state.
 * Authorised staff may perform exceptional transitions outside this map (Phase 3), but those
 * must be flagged as overrides and recorded in the history.
 */
export const STATUS_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  DRAFT: ["APPLICATION_SUBMITTED", "CANCELLED"],
  APPLICATION_SUBMITTED: ["PAYMENT_PENDING", "UNDER_REVIEW", "CANCELLED"],
  PAYMENT_PENDING: ["PAYMENT_CONFIRMED", "CANCELLED"],
  PAYMENT_CONFIRMED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["DOCUMENTS_REQUIRED", "PROCESSING", "ADDITIONAL_INFORMATION_REQUIRED", "CANCELLED"],
  DOCUMENTS_REQUIRED: ["DOCUMENTS_UNDER_REVIEW", "CANCELLED"],
  DOCUMENTS_UNDER_REVIEW: ["DOCUMENTS_REQUIRED", "UNDER_REVIEW", "PROCESSING"],
  PROCESSING: ["ADDITIONAL_INFORMATION_REQUIRED", "SUBMITTED_TO_AUTHORITY", "DECISION_PENDING", "CANCELLED"],
  ADDITIONAL_INFORMATION_REQUIRED: ["PROCESSING", "UNDER_REVIEW", "CANCELLED"],
  SUBMITTED_TO_AUTHORITY: ["DECISION_PENDING", "ADDITIONAL_INFORMATION_REQUIRED"],
  DECISION_PENDING: ["APPROVED", "REFUSED", "ADDITIONAL_INFORMATION_REQUIRED"],
  APPROVED: ["COMPLETED"],
  REFUSED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Statuses in which the client may still change their answers. */
export const CLIENT_EDITABLE_STATUSES: readonly ApplicationStatus[] = ["DRAFT"];

/** Statuses in which the client may upload / replace documents. */
export const CLIENT_UPLOAD_STATUSES: readonly ApplicationStatus[] = [
  "DRAFT",
  "DOCUMENTS_REQUIRED",
  "ADDITIONAL_INFORMATION_REQUIRED",
];
