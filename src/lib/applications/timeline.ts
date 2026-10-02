import type { ApplicationStatus } from "@/generated/prisma/enums";
import { STATUS_LABEL } from "./labels";

/**
 * Pure helpers that turn an application's status history into what the client sees:
 * a seven-stage progress timeline and a chronological list of events.
 */

export interface HistoryEntry {
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  note: string | null;
  isOverride?: boolean;
  createdAt: Date;
}

export type StageState = "done" | "current" | "upcoming";
export interface TimelineStage {
  key: string;
  title: string;
  description: string;
  state: StageState;
  /** When the stage was reached (null if upcoming, or reached without a recorded event). */
  at: Date | null;
}

const STAGES = [
  { key: "started", title: "Application started", description: "You began your application." },
  { key: "submitted", title: "Application submitted", description: "We've received your application." },
  { key: "payment", title: "Payment confirmed", description: "Your payment has been confirmed." },
  { key: "review", title: "Documents reviewed", description: "We review your application and documents." },
  { key: "processing", title: "Application processing", description: "Your application is being processed." },
  { key: "decision", title: "Decision pending", description: "The decision is awaited from the relevant authority." },
  { key: "completed", title: "Completed", description: "Your application is complete." },
] as const;

const STAGE_OF: Record<ApplicationStatus, number> = {
  DRAFT: 0,
  APPLICATION_SUBMITTED: 1,
  PAYMENT_PENDING: 2,
  PAYMENT_CONFIRMED: 2,
  UNDER_REVIEW: 3,
  DOCUMENTS_REQUIRED: 3,
  DOCUMENTS_UNDER_REVIEW: 3,
  PROCESSING: 4,
  ADDITIONAL_INFORMATION_REQUIRED: 4,
  SUBMITTED_TO_AUTHORITY: 4,
  DECISION_PENDING: 5,
  APPROVED: 6,
  REFUSED: 6,
  COMPLETED: 6,
  CANCELLED: -1,
};

export function stageIndex(status: ApplicationStatus): number {
  return STAGE_OF[status];
}

/** What the current status means to the client, shown under the highlighted stage. */
export const STATUS_DESCRIPTION: Record<ApplicationStatus, string> = {
  DRAFT: "You started your application.",
  APPLICATION_SUBMITTED: "Your application was submitted.",
  PAYMENT_PENDING: "Your payment is awaiting confirmation.",
  PAYMENT_CONFIRMED: "Your payment was confirmed.",
  UNDER_REVIEW: "Our team is reviewing your application.",
  DOCUMENTS_REQUIRED: "We need updated or additional documents from you.",
  DOCUMENTS_UNDER_REVIEW: "We're reviewing the documents you uploaded.",
  PROCESSING: "Your application is being processed.",
  ADDITIONAL_INFORMATION_REQUIRED: "We need additional information from you.",
  SUBMITTED_TO_AUTHORITY: "Your application has been submitted to the relevant authority.",
  DECISION_PENDING: "A decision is pending.",
  APPROVED: "The authority's decision: approved.",
  REFUSED: "The authority's decision: refused.",
  COMPLETED: "Your application is complete.",
  CANCELLED: "This application was cancelled.",
};

export function buildTimelineStages(status: ApplicationStatus, history: HistoryEntry[]): { stages: TimelineStage[]; cancelled: boolean } {
  const cancelled = status === "CANCELLED";
  const reached = history.filter((h) => h.toStatus !== "CANCELLED").map((h) => stageIndex(h.toStatus));
  const current = cancelled ? Math.max(0, ...reached) : stageIndex(status);
  const hadPayment = history.some((h) => h.toStatus === "PAYMENT_PENDING" || h.toStatus === "PAYMENT_CONFIRMED");

  const stages: TimelineStage[] = [];
  STAGES.forEach((def, i) => {
    // Packages without a payment step (or applications moved past it) never show a payment stage.
    if (def.key === "payment" && !hadPayment && current > i) return;
    if (def.key === "payment" && !hadPayment && current < i && !history.length) return;

    const done = cancelled ? i <= current : current > i || (i === 6 && status === "COMPLETED");
    const isCurrent = !cancelled && !done && current === i;
    const state: StageState = done ? "done" : isCurrent ? "current" : "upcoming";

    const times = history
      .filter((h) => (def.key === "payment" ? h.toStatus === "PAYMENT_CONFIRMED" : stageIndex(h.toStatus) === i))
      .map((h) => h.createdAt.getTime());
    const at = state === "upcoming" || (state === "current" && def.key === "payment" && status === "PAYMENT_PENDING") || times.length === 0 ? null : new Date(Math.min(...times));

    let title: string = def.title;
    let description: string = def.description;
    if (isCurrent) {
      description = STATUS_DESCRIPTION[status];
      if (i === 6) title = STATUS_LABEL[status];
      else if (def.key === "payment") title = "Payment";
    }
    stages.push({ key: def.key, title, description, state, at });
  });
  return { stages, cancelled };
}

export interface TimelineEvent {
  title: string;
  description: string;
  /** Message written by staff for the client, if any. */
  message: string | null;
  at: Date;
  status: ApplicationStatus;
}

/** Newest first. */
export function buildTimelineEvents(history: HistoryEntry[]): TimelineEvent[] {
  return [...history]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((h) => ({ title: STATUS_LABEL[h.toStatus], description: STATUS_DESCRIPTION[h.toStatus], message: h.note, at: h.createdAt, status: h.toStatus }));
}
