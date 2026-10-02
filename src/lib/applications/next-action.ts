import type { ApplicationStatus } from "@/generated/prisma/enums";

export interface NextAction {
  label: string;
  /** Where the client should go to act on it. */
  target: "wizard" | "documents" | "detail" | "payment";
  /** True when Vinamaz is waiting on the client. */
  urgent: boolean;
}

const TERMINAL: ApplicationStatus[] = ["APPROVED", "REFUSED", "COMPLETED", "CANCELLED"];
export const isTerminal = (s: ApplicationStatus) => TERMINAL.includes(s);

/** "What do I need to do?" for one application. Pure, so it's easy to test. */
export function nextAction(input: { status: ApplicationStatus; progressPercent: number; documentsToReplace: string[] }): NextAction | null {
  const { status, progressPercent, documentsToReplace } = input;
  if (status === "DRAFT") return { label: `Continue your application (${progressPercent}% complete)`, target: "wizard", urgent: true };
  if (isTerminal(status)) return null;
  if (documentsToReplace.length === 1) return { label: `Upload updated ${documentsToReplace[0]}`, target: "documents", urgent: true };
  if (documentsToReplace.length > 1) return { label: `Upload ${documentsToReplace.length} updated documents`, target: "documents", urgent: true };
  if (status === "DOCUMENTS_REQUIRED") return { label: "Upload the documents we've requested", target: "documents", urgent: true };
  if (status === "ADDITIONAL_INFORMATION_REQUIRED") return { label: "Read our request for additional information", target: "detail", urgent: true };
  if (status === "PAYMENT_PENDING") return { label: "Complete your payment", target: "payment", urgent: true };
  return { label: "Nothing needed from you right now. We're working on your application.", target: "detail", urgent: false };
}
