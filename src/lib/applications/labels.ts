import type { ApplicationStatus, DocumentStatus } from "@/generated/prisma/enums";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  DRAFT: "Draft",
  APPLICATION_SUBMITTED: "Application submitted",
  PAYMENT_PENDING: "Payment pending",
  PAYMENT_CONFIRMED: "Payment confirmed",
  UNDER_REVIEW: "Under review",
  DOCUMENTS_REQUIRED: "Documents required",
  DOCUMENTS_UNDER_REVIEW: "Documents under review",
  PROCESSING: "Processing",
  ADDITIONAL_INFORMATION_REQUIRED: "Additional information required",
  SUBMITTED_TO_AUTHORITY: "Submitted to authority",
  DECISION_PENDING: "Decision pending",
  APPROVED: "Approved",
  REFUSED: "Refused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_TONE: Record<ApplicationStatus, "neutral" | "gold" | "teal" | "ok" | "danger"> = {
  DRAFT: "neutral", APPLICATION_SUBMITTED: "teal", PAYMENT_PENDING: "gold", PAYMENT_CONFIRMED: "teal", UNDER_REVIEW: "teal",
  DOCUMENTS_REQUIRED: "gold", DOCUMENTS_UNDER_REVIEW: "teal", PROCESSING: "teal", ADDITIONAL_INFORMATION_REQUIRED: "gold",
  SUBMITTED_TO_AUTHORITY: "teal", DECISION_PENDING: "teal", APPROVED: "ok", REFUSED: "danger", COMPLETED: "ok", CANCELLED: "neutral",
};

export const DOC_STATUS_LABEL: Record<DocumentStatus, string> = {
  UPLOADED: "Uploaded",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  REPLACEMENT_REQUIRED: "Replacement required",
};

export const DOC_STATUS_TONE: Record<DocumentStatus, "neutral" | "gold" | "teal" | "ok" | "danger"> = {
  UPLOADED: "teal", UNDER_REVIEW: "teal", APPROVED: "ok", REJECTED: "danger", REPLACEMENT_REQUIRED: "gold",
};
