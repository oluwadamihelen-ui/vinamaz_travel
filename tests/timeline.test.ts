import { describe, expect, it } from "vitest";
import { buildTimelineEvents, buildTimelineStages, type HistoryEntry } from "@/lib/applications/timeline";
import { nextAction } from "@/lib/applications/next-action";
import type { ApplicationStatus } from "@/generated/prisma/enums";

const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 0, m));
const h = (to: ApplicationStatus, m: number, note: string | null = null, from: ApplicationStatus | null = null): HistoryEntry => ({ fromStatus: from, toStatus: to, note, createdAt: t(m) });

describe("buildTimelineStages", () => {
  it("marks earlier stages done and the current stage prominent", () => {
    const history = [h("DRAFT", 0), h("APPLICATION_SUBMITTED", 5), h("PAYMENT_PENDING", 6), h("PAYMENT_CONFIRMED", 10), h("UNDER_REVIEW", 12), h("PROCESSING", 30)];
    const { stages } = buildTimelineStages("PROCESSING", history);
    expect(stages.map((s) => `${s.key}:${s.state}`)).toEqual([
      "started:done", "submitted:done", "payment:done", "review:done", "processing:current", "decision:upcoming", "completed:upcoming",
    ]);
    expect(stages[1]!.at).toEqual(t(5));
    expect(stages[2]!.at).toEqual(t(10));
    expect(stages[4]!.description).toBe("Your application is being processed.");
    expect(stages[5]!.at).toBeNull();
  });
  it("omits the payment stage when the application never went through payment", () => {
    const { stages } = buildTimelineStages("PROCESSING", [h("DRAFT", 0), h("APPLICATION_SUBMITTED", 1), h("UNDER_REVIEW", 2), h("PROCESSING", 3)]);
    expect(stages.map((s) => s.key)).not.toContain("payment");
  });
  it("shows what the client must do while the stage is current", () => {
    const { stages } = buildTimelineStages("DOCUMENTS_REQUIRED", [h("DRAFT", 0), h("APPLICATION_SUBMITTED", 1), h("UNDER_REVIEW", 2), h("DOCUMENTS_REQUIRED", 3)]);
    const cur = stages.find((s) => s.state === "current")!;
    expect(cur.key).toBe("review");
    expect(cur.description).toMatch(/updated or additional documents/);
  });
  it("a draft only has the first stage current; payment pending shows 'Payment' without a time", () => {
    expect(buildTimelineStages("DRAFT", [h("DRAFT", 0)]).stages.find((s) => s.state === "current")!.key).toBe("started");
    const { stages } = buildTimelineStages("PAYMENT_PENDING", [h("DRAFT", 0), h("APPLICATION_SUBMITTED", 1), h("PAYMENT_PENDING", 2)]);
    const pay = stages.find((s) => s.key === "payment")!;
    expect(pay).toMatchObject({ state: "current", title: "Payment", at: null });
  });
  it("outcomes: approved/refused show as the final highlighted stage, completed is done", () => {
    const base = [h("DRAFT", 0), h("APPLICATION_SUBMITTED", 1), h("UNDER_REVIEW", 2), h("PROCESSING", 3), h("DECISION_PENDING", 4)];
    const approved = buildTimelineStages("APPROVED", [...base, h("APPROVED", 5)]).stages;
    expect(approved.at(-1)).toMatchObject({ key: "completed", state: "current", title: "Approved" });
    expect(buildTimelineStages("REFUSED", [...base, h("REFUSED", 5)]).stages.at(-1)!.title).toBe("Refused");
    const done = buildTimelineStages("COMPLETED", [...base, h("APPROVED", 5), h("COMPLETED", 6)]).stages;
    expect(done.every((s) => s.state === "done")).toBe(true);
  });
  it("cancelled applications keep what was reached and have no current stage", () => {
    const { stages, cancelled } = buildTimelineStages("CANCELLED", [h("DRAFT", 0), h("APPLICATION_SUBMITTED", 1), h("CANCELLED", 2)]);
    expect(cancelled).toBe(true);
    expect(stages.filter((s) => s.state === "current")).toHaveLength(0);
    expect(stages.filter((s) => s.state === "done").map((s) => s.key)).toEqual(["started", "submitted"]);
  });
});

describe("buildTimelineEvents", () => {
  it("is newest first and carries staff messages", () => {
    const ev = buildTimelineEvents([h("DRAFT", 0), h("DOCUMENTS_REQUIRED", 9, "Please upload a clearer passport scan"), h("APPLICATION_SUBMITTED", 3)]);
    expect(ev.map((e) => e.title)).toEqual(["Documents required", "Application submitted", "Draft"]);
    expect(ev[0]!.message).toBe("Please upload a clearer passport scan");
    expect(ev[1]!.message).toBeNull();
  });
});

describe("nextAction", () => {
  it("drafts point back to the wizard", () => {
    expect(nextAction({ status: "DRAFT", progressPercent: 40, documentsToReplace: [] })).toMatchObject({ target: "wizard", urgent: true, label: expect.stringContaining("40%") });
  });
  it("names the specific document to replace", () => {
    expect(nextAction({ status: "PROCESSING", progressPercent: 100, documentsToReplace: ["Bank statement"] })).toMatchObject({ label: "Upload updated Bank statement", target: "documents", urgent: true });
    expect(nextAction({ status: "UNDER_REVIEW", progressPercent: 100, documentsToReplace: ["A", "B"] })!.label).toBe("Upload 2 updated documents");
  });
  it("handles request states, quiet processing and terminal states", () => {
    expect(nextAction({ status: "DOCUMENTS_REQUIRED", progressPercent: 100, documentsToReplace: [] })!.urgent).toBe(true);
    expect(nextAction({ status: "ADDITIONAL_INFORMATION_REQUIRED", progressPercent: 100, documentsToReplace: [] })!.target).toBe("detail");
    expect(nextAction({ status: "PROCESSING", progressPercent: 100, documentsToReplace: [] })!.urgent).toBe(false);
    for (const s of ["APPROVED", "REFUSED", "COMPLETED", "CANCELLED"] as const) expect(nextAction({ status: s, progressPercent: 100, documentsToReplace: [] })).toBeNull();
  });
});
