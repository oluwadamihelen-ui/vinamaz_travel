import { Badge } from "@/components/ui/misc";
import type { Answers, QuestionDef, StepDef } from "@/lib/applications/engine";
import { questionsForStep, visibleQuestions } from "@/lib/applications/engine";
import { DOC_STATUS_LABEL, DOC_STATUS_TONE } from "@/lib/applications/labels";
import type { DocumentStatus } from "@/generated/prisma/enums";

function display(q: QuestionDef, v: Answers[string]): string {
  if (v === undefined) return "—";
  if (Array.isArray(v)) return v.map((x) => q.options.find((o) => o.value === x)?.label ?? x).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return q.options.find((o) => o.value === v)?.label ?? String(v);
}

const APPLICANT_LABELS: [string, string][] = [
  ["fullName", "Full name"], ["dateOfBirth", "Date of birth"], ["nationality", "Nationality"],
  ["countryOfResidence", "Country of residence"], ["phone", "Phone"], ["whatsapp", "WhatsApp"],
];

export function ApplicationSummary({
  applicant, steps, questions, answers, slots, docs,
}: {
  applicant: Record<string, unknown>; steps: StepDef[]; questions: QuestionDef[]; answers: Answers;
  slots: { key: string; name: string; isRequired: boolean }[];
  docs: { requirementKey: string; originalFilename: string; status: DocumentStatus }[];
}) {
  const visible = new Set(visibleQuestions(questions, answers).map((q) => q.key));
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold">Your details</h3>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {APPLICANT_LABELS.map(([k, label]) => (
            <div key={k}><dt className="text-ink-3">{label}</dt><dd className="font-medium">{(applicant[k] as string) || "—"}</dd></div>
          ))}
        </dl>
      </section>
      {steps.filter((s) => s.kind === "questions").map((s) => {
        const qs = questionsForStep(s, questions).filter((q) => visible.has(q.key));
        if (!qs.length) return null;
        return (
          <section key={s.key}>
            <h3 className="text-lg font-semibold">{s.title}</h3>
            <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {qs.map((q) => <div key={q.key}><dt className="text-ink-3">{q.label}</dt><dd className="whitespace-pre-line font-medium">{display(q, answers[q.key])}</dd></div>)}
            </dl>
          </section>
        );
      })}
      {slots.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold">Documents</h3>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white text-sm">
            {slots.map((s) => {
              const d = docs.find((x) => x.requirementKey === s.key);
              return (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div><p className="font-medium">{s.name}</p><p className="text-ink-3">{d ? d.originalFilename : s.isRequired ? "Not uploaded" : "Not provided (optional)"}</p></div>
                  {d ? <Badge tone={DOC_STATUS_TONE[d.status]}>{DOC_STATUS_LABEL[d.status]}</Badge> : s.isRequired ? <Badge tone="gold">Missing</Badge> : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
