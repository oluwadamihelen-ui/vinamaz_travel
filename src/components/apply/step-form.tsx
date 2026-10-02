"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { saveStepAction, type WizardState } from "@/lib/actions/applications";
import { visibleQuestions, type Answers, type QuestionDef } from "@/lib/applications/engine";
import { COUNTRIES } from "@/lib/countries";
import { QuestionField } from "./question-field";

interface Props {
  applicationId: string;
  stepKey: string;
  kind: "details" | "questions" | "documents";
  /** Rendered above the navigation for the documents step. */
  children?: React.ReactNode;
  applicant: Record<string, string | null | undefined>;
  /** Questions belonging to this step. */
  questions: QuestionDef[];
  /** Every question in the package (conditions may point at other steps). */
  allQuestions: QuestionDef[];
  answers: Answers;
  backHref: string | null;
  isLast: boolean;
}

export function StepForm({ applicationId, stepKey, kind, applicant, questions, allQuestions, answers, backHref, isLast, children }: Props) {
  const [state, action, pending] = useActionState(saveStepAction.bind(null, applicationId, stepKey), {} as WizardState);
  const [values, setValues] = useState<Answers>(answers);
  const [a, setA] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(applicant).map(([k, v]) => [k, v ?? ""])));
  const e = state.fieldErrors ?? {};

  const visible = new Set(visibleQuestions(allQuestions, values).map((q) => q.key));
  const shown = questions.filter((q) => visible.has(q.key));
  const field = (name: string, label: string, props: Partial<React.ComponentProps<typeof Input>> = {}, hint?: string) => (
    <Field label={label} htmlFor={name} error={e[name] ? [e[name]] : undefined} hint={hint}>
      <Input id={name} name={name} value={a[name] ?? ""} onChange={(ev) => setA((p) => ({ ...p, [name]: ev.target.value }))} aria-invalid={!!e[name]} {...props} />
    </Field>
  );

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.error && (
        <Alert>
          {state.error}
          {kind === "documents" && Object.values(e).length > 0 && <ul className="mt-1 list-disc pl-5">{Object.entries(e).map(([k, v]) => <li key={k}>{v}</li>)}</ul>}
        </Alert>
      )}
      {kind === "documents" ? (
        <div className="space-y-4">{children}</div>
      ) : kind === "details" ? (
        <div className="space-y-5">
          {field("fullName", "Full name (as shown on your passport)", { autoComplete: "name" })}
          {field("dateOfBirth", "Date of birth", { type: "date" })}
          {field("nationality", "Nationality")}
          <Field label="Country of residence" htmlFor="countryOfResidence" error={e.countryOfResidence ? [e.countryOfResidence] : undefined}>
            <Select id="countryOfResidence" name="countryOfResidence" value={a.countryOfResidence ?? ""} onChange={(ev) => setA((p) => ({ ...p, countryOfResidence: ev.target.value }))} aria-invalid={!!e.countryOfResidence}>
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          {field("phone", "Phone number", { type: "tel", autoComplete: "tel" }, "Include your country code, e.g. +234…")}
          {field("whatsapp", "WhatsApp number (optional)", { type: "tel" })}
        </div>
      ) : (
        <div className="space-y-5">
          {shown.map((q) => (
            <QuestionField key={q.key} q={q} value={values[q.key]} error={e[q.key]} onChange={(v) => setValues((p) => ({ ...p, [q.key]: v }))} />
          ))}
          {shown.length === 0 && <p className="text-ink-3">Nothing to answer in this section based on your earlier answers.</p>}
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          {backHref && <Button asChild variant="ghost"><Link href={backHref}><ArrowLeft className="size-4" />Back</Link></Button>}
          <Button type="submit" name="intent" value="save" variant="outline" disabled={pending}>Save &amp; exit</Button>
        </div>
        <Button type="submit" name="intent" value="next" size="lg" disabled={pending}>
          {pending ? "Saving…" : isLast ? "Continue" : "Save & continue"} <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  );
}
