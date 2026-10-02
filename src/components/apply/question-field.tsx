"use client";

import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { COUNTRIES } from "@/lib/countries";
import type { AnswerValue, QuestionDef } from "@/lib/applications/engine";

/** Renders one package question. Controlled, so values survive failed submissions. */
export function QuestionField({
  q, value, error, onChange,
}: { q: QuestionDef; value: AnswerValue | undefined; error?: string; onChange: (v: AnswerValue | undefined) => void }) {
  const id = `q_${q.key}`;
  const str = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const label = q.isRequired ? q.label : `${q.label} (optional)`;
  const common = { id, name: id, "aria-invalid": !!error } as const;

  switch (q.type) {
    case "TEXTAREA":
      return <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}><Textarea {...common} value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "NUMBER":
      return <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}><Input {...common} type="text" inputMode="decimal" value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "DATE":
      return <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}><Input {...common} type="date" value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "PHONE":
      return <Field label={label} htmlFor={id} hint={q.helpText ?? "Include your country code"} error={error ? [error] : undefined}><Input {...common} type="tel" value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "EMAIL":
      return <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}><Input {...common} type="email" value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
    case "COUNTRY":
      return (
        <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}>
          <Select {...common} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select a country</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      );
    case "SELECT":
      return (
        <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}>
          <Select {...common} value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select an option</option>
            {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      );
    case "RADIO":
      return (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{label}</legend>
          {q.helpText && <p className="mb-2 text-xs text-ink-3">{q.helpText}</p>}
          <div className="space-y-2">
            {q.options.map((o) => (
              <label key={o.value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-white px-4 text-[15px] has-[:checked]:border-teal has-[:checked]:bg-teal-soft/50">
                <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="size-5 accent-ink" />
                {o.label}
              </label>
            ))}
          </div>
          {error && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
        </fieldset>
      );
    case "MULTI_SELECT": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{label}</legend>
          {q.helpText && <p className="mb-2 text-xs text-ink-3">{q.helpText}</p>}
          <div className="space-y-2">
            {q.options.map((o) => (
              <label key={o.value} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-white px-4 text-[15px] has-[:checked]:border-teal has-[:checked]:bg-teal-soft/50">
                <input type="checkbox" name={id} value={o.value} checked={selected.includes(o.value)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))} className="size-5 accent-ink" />
                {o.label}
              </label>
            ))}
          </div>
          {error && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
        </fieldset>
      );
    }
    case "CHECKBOX":
      return (
        <div>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line bg-white px-4 text-[15px]">
            <input type="checkbox" name={id} checked={value === true} onChange={(e) => onChange(e.target.checked ? true : undefined)} className="size-5 accent-ink" />
            {label}
          </label>
          {q.helpText && <p className="mt-1.5 text-xs text-ink-3">{q.helpText}</p>}
          {error && <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
        </div>
      );
    default:
      return <Field label={label} htmlFor={id} hint={q.helpText ?? undefined} error={error ? [error] : undefined}><Input {...common} value={str} onChange={(e) => onChange(e.target.value)} /></Field>;
  }
}
