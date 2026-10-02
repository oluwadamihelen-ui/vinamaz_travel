import { COUNTRIES } from "@/lib/countries";
import { keyify } from "@/lib/slug";

/**
 * Pure (no I/O) application-form engine: question visibility, answer validation, wizard
 * steps and progress. Everything the server enforces lives here so it can be unit-tested.
 */

export type QuestionType =
  | "TEXT" | "TEXTAREA" | "DATE" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "RADIO" | "CHECKBOX" | "COUNTRY" | "PHONE" | "EMAIL" | "FILE";

export interface Condition {
  questionKey: string;
  operator: "equals" | "notEquals" | "in";
  value: string | string[];
}

export interface QuestionDef {
  key: string;
  label: string;
  helpText: string | null;
  type: QuestionType;
  isRequired: boolean;
  section: string | null;
  condition: Condition | null;
  options: { value: string; label: string }[];
}

export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue | undefined>;

export const DEFAULT_SECTION = "Application details";

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

function matches(cond: Condition, actual: AnswerValue | undefined): boolean {
  const list = Array.isArray(actual) ? actual : actual === undefined ? [] : [String(actual)];
  const wanted = Array.isArray(cond.value) ? cond.value : [cond.value];
  switch (cond.operator) {
    case "equals": return wanted.length > 0 && list.includes(String(wanted[0]));
    case "notEquals": return !list.includes(String(wanted[0]));
    case "in": return wanted.some((w) => list.includes(w));
  }
}

/** A question is visible if it has no condition, or its condition holds AND the question it depends on is itself visible. */
export function visibleQuestions(questions: QuestionDef[], answers: Answers): QuestionDef[] {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const memo = new Map<string, boolean>();
  const visit = (q: QuestionDef, seen: Set<string>): boolean => {
    const cached = memo.get(q.key);
    if (cached !== undefined) return cached;
    let result = true;
    if (q.condition) {
      const dep = byKey.get(q.condition.questionKey);
      if (!dep || seen.has(dep.key)) result = false; // unknown dependency or cycle => hidden
      else result = visit(dep, new Set(seen).add(q.key)) && matches(q.condition, answers[dep.key]);
    }
    memo.set(q.key, result);
    return result;
  };
  return questions.filter((q) => visit(q, new Set()));
}

// ---------------------------------------------------------------------------
// Answer validation
// ---------------------------------------------------------------------------

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_SET = new Set<string>(COUNTRIES);

export type ValidationResult = { ok: true; value: AnswerValue | undefined } | { ok: false; error: string };

export function isEmptyAnswer(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/**
 * Validate one raw answer against its question. `partial` (draft save) accepts empty values
 * for required questions but still rejects malformed ones.
 */
export function validateAnswer(q: QuestionDef, raw: unknown, partial = false): ValidationResult {
  if (q.type === "FILE") return { ok: true, value: undefined }; // handled by the document upload flow
  if (typeof raw === "string") raw = raw.trim();

  if (q.type === "CHECKBOX") {
    const checked = raw === true || raw === "on" || raw === "true";
    if (!partial && q.isRequired && !checked) return { ok: false, error: "This must be ticked" };
    return { ok: true, value: checked ? true : undefined };
  }

  if (isEmptyAnswer(raw)) {
    if (!partial && q.isRequired) return { ok: false, error: "This field is required" };
    return { ok: true, value: undefined };
  }

  const allowed = new Set(q.options.map((o) => o.value));
  switch (q.type) {
    case "TEXT":
    case "TEXTAREA": {
      if (typeof raw !== "string") return { ok: false, error: "Enter text" };
      const max = q.type === "TEXT" ? 500 : 5000;
      if (raw.length > max) return { ok: false, error: `Use at most ${max} characters` };
      return { ok: true, value: raw };
    }
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (typeof raw === "boolean" || !Number.isFinite(n)) return { ok: false, error: "Enter a valid number" };
      return { ok: true, value: n };
    }
    case "DATE": {
      if (typeof raw !== "string" || !DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) return { ok: false, error: "Enter a valid date" };
      return { ok: true, value: raw };
    }
    case "SELECT":
    case "RADIO":
      if (typeof raw !== "string" || !allowed.has(raw)) return { ok: false, error: "Choose one of the options" };
      return { ok: true, value: raw };
    case "MULTI_SELECT": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : null;
      if (!arr || arr.some((v) => typeof v !== "string" || !allowed.has(v))) return { ok: false, error: "Choose from the available options" };
      return { ok: true, value: [...new Set(arr)] };
    }
    case "COUNTRY":
      if (typeof raw !== "string" || !COUNTRY_SET.has(raw)) return { ok: false, error: "Select a country from the list" };
      return { ok: true, value: raw };
    case "PHONE":
      if (typeof raw !== "string" || !PHONE_RE.test(raw)) return { ok: false, error: "Enter a valid phone number" };
      return { ok: true, value: raw };
    case "EMAIL":
      if (typeof raw !== "string" || raw.length > 254 || !EMAIL_RE.test(raw)) return { ok: false, error: "Enter a valid email address" };
      return { ok: true, value: raw.toLowerCase() };
  }
}

/** Validate a set of raw answers for the visible questions only. Hidden questions are dropped. */
export function validateAnswers(
  questions: QuestionDef[],
  raw: Record<string, unknown>,
  opts: { partial?: boolean; context?: Answers; allQuestions?: QuestionDef[] } = {},
): { values: Answers; errors: Record<string, string> } {
  const context: Answers = { ...(opts.context ?? {}) };
  const values: Answers = {};
  const errors: Record<string, string> = {};
  // Visibility depends on answers, so evaluate against the merged (context + incoming) answers.
  const merged: Answers = { ...context };
  for (const q of questions) {
    const r = validateAnswer(q, raw[q.key], true);
    if (r.ok) merged[q.key] = r.value;
  }
  // Conditions may refer to questions in other wizard steps, so visibility uses the full set.
  const visible = new Set(visibleQuestions(opts.allQuestions ?? questions, merged).map((q) => q.key));
  for (const q of questions) {
    if (!visible.has(q.key)) continue;
    const r = validateAnswer(q, raw[q.key], opts.partial ?? false);
    if (!r.ok) errors[q.key] = r.error;
    else if (r.value !== undefined) values[q.key] = r.value;
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

export type StepKind = "details" | "questions" | "documents" | "review";
export interface StepDef {
  key: string;
  title: string;
  kind: StepKind;
  /** Section name for "questions" steps. */
  section?: string;
}

/**
 * Steps are derived from the package configuration: a fixed "Your details" step, one step
 * per question section (in order of first appearance), a documents step when the package
 * needs uploads, and a final review. No package content is hard-coded.
 */
export function buildSteps(questions: QuestionDef[], hasDocuments: boolean): StepDef[] {
  const steps: StepDef[] = [{ key: "details", title: "Your details", kind: "details" }];
  const sections: string[] = [];
  for (const q of questions) {
    if (q.type === "FILE") continue;
    const s = q.section?.trim() || DEFAULT_SECTION;
    if (!sections.includes(s)) sections.push(s);
  }
  const used = new Set<string>(["details", "documents", "review"]);
  for (const s of sections) {
    let key = `s-${keyify(s) || "section"}`;
    while (used.has(key)) key += "_";
    used.add(key);
    steps.push({ key, title: s, kind: "questions", section: s });
  }
  if (hasDocuments) steps.push({ key: "documents", title: "Documents", kind: "documents" });
  steps.push({ key: "review", title: "Review", kind: "review" });
  return steps;
}

export function questionsForStep(step: StepDef, questions: QuestionDef[]): QuestionDef[] {
  if (step.kind !== "questions") return [];
  return questions.filter((q) => q.type !== "FILE" && (q.section?.trim() || DEFAULT_SECTION) === step.section);
}

// ---------------------------------------------------------------------------
// Document slots & progress
// ---------------------------------------------------------------------------

export interface DocumentSlot {
  key: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  acceptedFormats: string[];
  maxSizeMb: number;
}

export interface DocReqDef {
  key: string; name: string; description: string | null; isRequired: boolean; acceptedFormats: string[]; maxSizeMb: number;
}

/** Package document requirements plus visible FILE questions, as upload slots. */
export function documentSlots(docReqs: DocReqDef[], questions: QuestionDef[], answers: Answers): DocumentSlot[] {
  const slots: DocumentSlot[] = docReqs.map((d) => ({ ...d }));
  const taken = new Set(slots.map((s) => s.key));
  for (const q of visibleQuestions(questions, answers)) {
    if (q.type !== "FILE" || taken.has(q.key)) continue;
    slots.push({ key: q.key, name: q.label, description: q.helpText, isRequired: q.isRequired, acceptedFormats: ["pdf", "jpg", "png"], maxSizeMb: 10 });
  }
  return slots;
}

export const applicantSchemaKeys = ["fullName", "dateOfBirth", "nationality", "countryOfResidence", "phone"] as const;

export interface ProgressInput {
  applicant: Record<string, unknown>;
  questions: QuestionDef[];
  answers: Answers;
  slots: DocumentSlot[];
  uploadedSlotKeys: Set<string>;
}

/** Form-completion progress (0-100): required items answered / required items. Not processing status. */
export function computeProgress(input: ProgressInput): { percent: number; done: number; total: number } {
  let total = 0;
  let done = 0;
  for (const k of applicantSchemaKeys) {
    total++;
    if (!isEmptyAnswer(input.applicant[k])) done++;
  }
  for (const q of visibleQuestions(input.questions, input.answers)) {
    if (q.type === "FILE" || !q.isRequired) continue;
    total++;
    const v = input.answers[q.key];
    if (!isEmptyAnswer(v) && !(q.type === "CHECKBOX" && v !== true)) done++;
  }
  for (const s of input.slots) {
    if (!s.isRequired) continue;
    total++;
    if (input.uploadedSlotKeys.has(s.key)) done++;
  }
  return { percent: total === 0 ? 0 : Math.round((done / total) * 100), done, total };
}
