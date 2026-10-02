import { describe, expect, it } from "vitest";
import {
  buildSteps, computeProgress, documentSlots, questionsForStep, validateAnswer, validateAnswers, visibleQuestions, type QuestionDef,
} from "@/lib/applications/engine";
import { canTransition, STATUS_TRANSITIONS } from "@/lib/applications/status";
import { effectiveMaxBytes, safeFilename, sniffFormat } from "@/lib/applications/files";

const q = (over: Partial<QuestionDef> & { key: string }): QuestionDef => ({
  label: over.key, helpText: null, type: "TEXT", isRequired: false, section: null, condition: null, options: [], ...over,
});
const marital = q({ key: "marital", type: "SELECT", isRequired: true, section: "Family", options: [{ value: "single", label: "Single" }, { value: "married", label: "Married" }] });
const spouse = q({ key: "spouse", isRequired: true, section: "Family", condition: { questionKey: "marital", operator: "equals", value: "married" } });

describe("conditional visibility", () => {
  it("shows dependent questions only when the condition holds", () => {
    expect(visibleQuestions([marital, spouse], { marital: "single" }).map((x) => x.key)).toEqual(["marital"]);
    expect(visibleQuestions([marital, spouse], { marital: "married" }).map((x) => x.key)).toEqual(["marital", "spouse"]);
    expect(visibleQuestions([marital, spouse], {}).map((x) => x.key)).toEqual(["marital"]);
  });
  it("supports notEquals / in / multi-select answers", () => {
    const a = q({ key: "a", condition: { questionKey: "m", operator: "notEquals", value: "x" } });
    const b = q({ key: "b", condition: { questionKey: "m", operator: "in", value: ["x", "y"] } });
    const m = q({ key: "m", type: "MULTI_SELECT", options: [{ value: "x", label: "x" }, { value: "z", label: "z" }] });
    expect(visibleQuestions([m, a, b], { m: ["x", "z"] }).map((x) => x.key)).toEqual(["m", "b"]);
    expect(visibleQuestions([m, a, b], { m: ["z"] }).map((x) => x.key)).toEqual(["m", "a"]);
  });
  it("hides questions whose dependency is hidden, unknown, or cyclic", () => {
    const grand = q({ key: "grand", condition: { questionKey: "spouse", operator: "equals", value: "yes" } });
    expect(visibleQuestions([marital, spouse, grand], { marital: "single", spouse: "yes" }).map((x) => x.key)).toEqual(["marital"]);
    const orphan = q({ key: "o", condition: { questionKey: "missing", operator: "equals", value: "1" } });
    expect(visibleQuestions([orphan], {})).toEqual([]);
    const c1 = q({ key: "c1", condition: { questionKey: "c2", operator: "equals", value: "1" } });
    const c2 = q({ key: "c2", condition: { questionKey: "c1", operator: "equals", value: "1" } });
    expect(visibleQuestions([c1, c2], { c1: "1", c2: "1" })).toEqual([]);
  });
});

describe("answer validation", () => {
  it("enforces required unless partial, and rejects malformed values either way", () => {
    expect(validateAnswer(marital, "", false)).toMatchObject({ ok: false });
    expect(validateAnswer(marital, "", true)).toEqual({ ok: true, value: undefined });
    expect(validateAnswer(marital, "divorced", true)).toMatchObject({ ok: false });
    expect(validateAnswer(marital, "single")).toEqual({ ok: true, value: "single" });
  });
  it("validates each answer type", () => {
    expect(validateAnswer(q({ key: "n", type: "NUMBER" }), "12.5")).toEqual({ ok: true, value: 12.5 });
    expect(validateAnswer(q({ key: "n", type: "NUMBER" }), "abc")).toMatchObject({ ok: false });
    expect(validateAnswer(q({ key: "d", type: "DATE" }), "2024-02-30x")).toMatchObject({ ok: false });
    expect(validateAnswer(q({ key: "d", type: "DATE" }), "2024-02-10")).toEqual({ ok: true, value: "2024-02-10" });
    expect(validateAnswer(q({ key: "e", type: "EMAIL" }), "A@B.com")).toEqual({ ok: true, value: "a@b.com" });
    expect(validateAnswer(q({ key: "e", type: "EMAIL" }), "nope")).toMatchObject({ ok: false });
    expect(validateAnswer(q({ key: "p", type: "PHONE" }), "+234 803 000 0000")).toMatchObject({ ok: true });
    expect(validateAnswer(q({ key: "c", type: "COUNTRY" }), "Canada")).toMatchObject({ ok: true });
    expect(validateAnswer(q({ key: "c", type: "COUNTRY" }), "Narnia")).toMatchObject({ ok: false });
    expect(validateAnswer(q({ key: "t", type: "TEXT" }), "x".repeat(501))).toMatchObject({ ok: false });
    const multi = q({ key: "m", type: "MULTI_SELECT", options: [{ value: "a", label: "a" }, { value: "b", label: "b" }] });
    expect(validateAnswer(multi, ["a", "b", "a"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(validateAnswer(multi, ["a", "zzz"])).toMatchObject({ ok: false });
    const cb = q({ key: "cb", type: "CHECKBOX", isRequired: true });
    expect(validateAnswer(cb, undefined)).toMatchObject({ ok: false });
    expect(validateAnswer(cb, "on")).toEqual({ ok: true, value: true });
  });
  it("validateAnswers drops hidden questions and only requires visible ones", () => {
    const r1 = validateAnswers([marital, spouse], { marital: "single", spouse: "ignored" });
    expect(r1.errors).toEqual({});
    expect(r1.values).toEqual({ marital: "single" });
    const r2 = validateAnswers([marital, spouse], { marital: "married" });
    expect(r2.errors).toHaveProperty("spouse");
  });
  it("evaluates conditions across steps using allQuestions + context", () => {
    const r = validateAnswers([spouse], { spouse: "Ada" }, { context: { marital: "married" }, allQuestions: [marital, spouse] });
    expect(r.errors).toEqual({});
    expect(r.values).toEqual({ spouse: "Ada" });
    const hidden = validateAnswers([spouse], { spouse: "Ada" }, { context: { marital: "single" }, allQuestions: [marital, spouse] });
    expect(hidden.values).toEqual({});
  });
});

describe("steps, slots and progress", () => {
  const passport = q({ key: "passport", isRequired: true, section: "Passport" });
  const loose = q({ key: "loose" });
  const fileQ = q({ key: "invite", type: "FILE", isRequired: true, label: "Invitation letter" });

  it("builds steps from sections in order of first appearance", () => {
    const steps = buildSteps([marital, spouse, passport, loose, fileQ], true);
    expect(steps.map((s) => s.title)).toEqual(["Your details", "Family", "Passport", "Application details", "Documents", "Review"]);
    expect(buildSteps([], false).map((s) => s.key)).toEqual(["details", "review"]);
    const fam = steps.find((s) => s.section === "Family")!;
    expect(questionsForStep(fam, [marital, spouse, passport]).map((x) => x.key)).toEqual(["marital", "spouse"]);
    expect(steps.some((s) => questionsForStep(s, [fileQ]).length)).toBe(false);
  });
  it("turns FILE questions into upload slots alongside package document requirements", () => {
    const slots = documentSlots([{ key: "passport", name: "Passport", description: null, isRequired: true, acceptedFormats: ["pdf"], maxSizeMb: 5 }], [fileQ], {});
    expect(slots.map((s) => s.key)).toEqual(["passport", "invite"]);
  });
  it("computes form-completion progress from required items", () => {
    const base = { applicant: {}, questions: [marital, spouse, passport], answers: {}, slots: [], uploadedSlotKeys: new Set<string>() };
    expect(computeProgress(base).percent).toBe(0);
    const some = computeProgress({ ...base, applicant: { fullName: "A", dateOfBirth: "1990-01-01", nationality: "N", countryOfResidence: "Nigeria", phone: "+2348000000" }, answers: { marital: "single" } });
    expect(some).toMatchObject({ done: 6, total: 7 });
    const all = computeProgress({ ...base, applicant: { fullName: "A", dateOfBirth: "1990-01-01", nationality: "N", countryOfResidence: "Nigeria", phone: "+2348000000" }, answers: { marital: "single", passport: "X" } });
    expect(all.percent).toBe(100);
  });
});

describe("status transitions", () => {
  it("allows the documented path and rejects shortcuts", () => {
    expect(canTransition("DRAFT", "APPLICATION_SUBMITTED")).toBe(true);
    expect(canTransition("APPLICATION_SUBMITTED", "PAYMENT_PENDING")).toBe(true);
    expect(canTransition("PAYMENT_PENDING", "PAYMENT_CONFIRMED")).toBe(true);
    expect(canTransition("PAYMENT_CONFIRMED", "UNDER_REVIEW")).toBe(true);
    expect(canTransition("DECISION_PENDING", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "COMPLETED")).toBe(true);
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
    expect(canTransition("DRAFT", "PROCESSING")).toBe(false);
    expect(canTransition("COMPLETED", "DRAFT")).toBe(false);
    expect(canTransition("REFUSED", "APPROVED")).toBe(false);
  });
  it("terminal states have no exits and every status is defined", () => {
    expect(STATUS_TRANSITIONS.COMPLETED).toEqual([]);
    expect(STATUS_TRANSITIONS.CANCELLED).toEqual([]);
    expect(Object.keys(STATUS_TRANSITIONS)).toHaveLength(15);
  });
});

describe("file helpers", () => {
  it("sniffs by content, not by name", () => {
    expect(sniffFormat(Buffer.from("%PDF-1.7 ..."))).toBe("pdf");
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffFormat(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(sniffFormat(Buffer.from("<script>alert(1)</script>"))).toBeNull();
  });
  it("sanitises filenames and caps size at the server limit", () => {
    expect(safeFilename("../../etc/passwd.exe", "pdf")).toBe("passwd.pdf");
    expect(safeFilename("My Passport (final)!!.JPG", "jpg")).toBe("My Passport final.jpg");
    expect(safeFilename("", "png")).toBe("document.png");
    expect(effectiveMaxBytes(1)).toBe(1024 * 1024);
    expect(effectiveMaxBytes(25)).toBe(4 * 1024 * 1024);
  });
});
