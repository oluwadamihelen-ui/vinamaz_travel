"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, Card } from "@/components/ui/misc";
import { savePackageAction } from "@/lib/actions/packages";
import type { FormState } from "@/lib/actions/auth";

type QuestionType = "TEXT" | "TEXTAREA" | "DATE" | "NUMBER" | "SELECT" | "MULTI_SELECT" | "RADIO" | "CHECKBOX" | "COUNTRY" | "PHONE" | "EMAIL" | "FILE";
type Condition = { questionKey: string; operator: "equals" | "notEquals" | "in"; value: string | string[] } | null;

export interface PackageFormData {
  name: string; country: string; slug: string; category: string;
  shortDescription: string; description: string;
  imageUrl: string | null; imageAlt: string;
  price: string; applicationFee: string; serviceFee: string; currency: string;
  processingEstimate: string;
  inclusions: string[]; exclusions: string[];
  importantInfo: string; terms: string;
  faqs: { question: string; answer: string }[];
  status: "DRAFT" | "ACTIVE" | "INACTIVE"; isFeatured: boolean; displayOrder: number;
  requirements: { type: "ELIGIBILITY" | "REQUIREMENT"; title: string; description: string }[];
  documentRequirements: { key?: string; name: string; description: string; isRequired: boolean; acceptedFormats: ("pdf" | "jpg" | "png")[]; maxSizeMb: number }[];
  questions: { key?: string; label: string; helpText: string; type: QuestionType; isRequired: boolean; section: string; condition: Condition; options: { label: string; value?: string }[] }[];
}

const EMPTY: PackageFormData = {
  name: "", country: "", slug: "", category: "", shortDescription: "", description: "", imageUrl: null, imageAlt: "",
  price: "", applicationFee: "", serviceFee: "", currency: "NGN", processingEstimate: "",
  inclusions: [], exclusions: [], importantInfo: "", terms: "", faqs: [],
  status: "DRAFT", isFeatured: false, displayOrder: 0, requirements: [], documentRequirements: [], questions: [],
};

const QUESTION_TYPES: QuestionType[] = ["TEXT", "TEXTAREA", "DATE", "NUMBER", "SELECT", "MULTI_SELECT", "RADIO", "CHECKBOX", "COUNTRY", "PHONE", "EMAIL", "FILE"];
const HAS_OPTIONS = ["SELECT", "MULTI_SELECT", "RADIO"];
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function SectionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-3">{hint}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </Card>
  );
}

function RowShell({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <div className="relative rounded-2xl border border-line bg-paper/60 p-4 pr-14">
      <button type="button" onClick={onRemove} aria-label="Remove" className="absolute right-3 top-3 grid size-10 place-items-center rounded-full text-ink-3 hover:bg-danger-soft hover:text-danger"><Trash2 className="size-4" /></button>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function PackageForm({ id, initial }: { id: string | null; initial: PackageFormData | null }) {
  const [d, setD] = useState<PackageFormData>(initial ?? EMPTY);
  const [state, action, pending] = useActionState(savePackageAction.bind(null, id), {} as FormState);
  const set = <K extends keyof PackageFormData>(k: K, v: PackageFormData[K]) => setD((p) => ({ ...p, [k]: v }));
  const update = <K extends "requirements" | "documentRequirements" | "questions" | "faqs">(k: K, i: number, patch: Partial<PackageFormData[K][number]>) =>
    setD((p) => ({ ...p, [k]: (p[k] as object[]).map((row, idx) => (idx === i ? { ...row, ...patch } : row)) }) as PackageFormData);
  const remove = (k: "requirements" | "documentRequirements" | "questions" | "faqs", i: number) =>
    setD((p) => ({ ...p, [k]: (p[k] as object[]).filter((_, idx) => idx !== i) }) as PackageFormData);

  const fe = state.fieldErrors ?? {};
  const err = (k: string) => fe[k];

  // Everything except the image file travels as one validated JSON payload.
  const payload = JSON.stringify({ ...d, imageUrl: undefined, inclusions: lines(d.inclusions.join("\n")), exclusions: lines(d.exclusions.join("\n")) });

  return (
    <form action={action} className="space-y-6" encType="multipart/form-data">
      <input type="hidden" name="payload" value={payload} />
      {state.error && <Alert>{state.error}{Object.keys(fe).length > 0 && <ul className="mt-2 list-disc pl-5">{Object.entries(fe).slice(0, 6).map(([k, v]) => <li key={k}>{k}: {v[0]}</li>)}</ul>}</Alert>}

      <SectionCard title="Basics">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Package name" htmlFor="name" error={err("name")}><Input id="name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Canada Visa Assistance" /></Field>
          <Field label="Destination country" htmlFor="country" error={err("country")}><Input id="country" value={d.country} onChange={(e) => set("country", e.target.value)} /></Field>
          <Field label="URL slug" htmlFor="slug" error={err("slug")} hint="Leave blank to generate from the name. Appears as /packages/your-slug."><Input id="slug" value={d.slug} onChange={(e) => set("slug", e.target.value)} /></Field>
          <Field label="Category" htmlFor="category" hint="Free text, e.g. Visa assistance"><Input id="category" value={d.category} onChange={(e) => set("category", e.target.value)} /></Field>
        </div>
        <Field label="Short description" htmlFor="shortDescription" error={err("shortDescription")} hint="Shown on package cards. Do not promise visa approval."><Textarea id="shortDescription" className="min-h-20" maxLength={300} value={d.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} /></Field>
        <Field label="Full description" htmlFor="description" hint="Blank lines create paragraphs."><Textarea id="description" className="min-h-40" value={d.description} onChange={(e) => set("description", e.target.value)} /></Field>
      </SectionCard>

      <SectionCard title="Package image" hint="Public marketing image (JPG, PNG or WebP, up to 5MB). Never upload applicant documents here.">
        {d.imageUrl && (
          <div className="flex items-center gap-4">
            <div className="relative h-24 w-36 overflow-hidden rounded-xl border border-line"><Image src={d.imageUrl} alt="" fill sizes="144px" className="object-cover" unoptimized /></div>
            <Checkbox name="removeImage" label="Remove current image" />
          </div>
        )}
        <Field label={d.imageUrl ? "Replace image" : "Upload image"} htmlFor="image" error={err("image")}>
          <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-4 file:h-11 file:rounded-full file:border-0 file:bg-ink file:px-5 file:text-sm file:font-medium file:text-white" />
        </Field>
        <Field label="Image description (alt text)" htmlFor="imageAlt"><Input id="imageAlt" value={d.imageAlt} onChange={(e) => set("imageAlt", e.target.value)} /></Field>
      </SectionCard>

      <SectionCard title="Pricing & timeline" hint="Leave any field blank if it is not confirmed. Blank values are never shown publicly.">
        <div className="grid gap-5 sm:grid-cols-4">
          <Field label="Package price" htmlFor="price" error={err("price")}><Input id="price" inputMode="decimal" value={d.price} onChange={(e) => set("price", e.target.value)} /></Field>
          <Field label="Application fee" htmlFor="applicationFee" error={err("applicationFee")}><Input id="applicationFee" inputMode="decimal" value={d.applicationFee} onChange={(e) => set("applicationFee", e.target.value)} /></Field>
          <Field label="Service fee" htmlFor="serviceFee" error={err("serviceFee")}><Input id="serviceFee" inputMode="decimal" value={d.serviceFee} onChange={(e) => set("serviceFee", e.target.value)} /></Field>
          <Field label="Currency" htmlFor="currency" error={err("currency")}><Input id="currency" maxLength={3} value={d.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
        </div>
        <Field label="Processing estimate" htmlFor="processingEstimate" hint="e.g. a range your team has confirmed. Leave blank if unknown."><Input id="processingEstimate" value={d.processingEstimate} onChange={(e) => set("processingEstimate", e.target.value)} /></Field>
      </SectionCard>

      <SectionCard title="Inclusions & exclusions" hint="One item per line.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="What's included" htmlFor="inclusions"><Textarea id="inclusions" value={d.inclusions.join("\n")} onChange={(e) => set("inclusions", e.target.value.split("\n"))} onBlur={() => set("inclusions", lines(d.inclusions.join("\n")))} /></Field>
          <Field label="Not included" htmlFor="exclusions"><Textarea id="exclusions" value={d.exclusions.join("\n")} onChange={(e) => set("exclusions", e.target.value.split("\n"))} onBlur={() => set("exclusions", lines(d.exclusions.join("\n")))} /></Field>
        </div>
      </SectionCard>

      <SectionCard title="Eligibility & requirements">
        {d.requirements.map((r, i) => (
          <RowShell key={i} onRemove={() => remove("requirements", i)}>
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field label="Type"><Select value={r.type} onChange={(e) => update("requirements", i, { type: e.target.value as "ELIGIBILITY" | "REQUIREMENT" })}><option value="ELIGIBILITY">Eligibility</option><option value="REQUIREMENT">Requirement</option></Select></Field>
              <Field label="Title" error={err(`requirements.${i}.title`)}><Input value={r.title} onChange={(e) => update("requirements", i, { title: e.target.value })} /></Field>
            </div>
            <Field label="Details (optional)"><Textarea className="min-h-20" value={r.description} onChange={(e) => update("requirements", i, { description: e.target.value })} /></Field>
          </RowShell>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setD((p) => ({ ...p, requirements: [...p.requirements, { type: "REQUIREMENT", title: "", description: "" }] }))}><Plus className="size-4" />Add requirement</Button>
      </SectionCard>

      <SectionCard title="Document requirements" hint="Documents the client will be asked to upload for this package.">
        {d.documentRequirements.map((r, i) => (
          <RowShell key={r.key ?? i} onRemove={() => remove("documentRequirements", i)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Document name" error={err(`documentRequirements.${i}.name`)}><Input value={r.name} onChange={(e) => update("documentRequirements", i, { name: e.target.value })} placeholder="e.g. International passport" /></Field>
              <Field label="Max size (MB)"><Input type="number" min={1} max={25} value={r.maxSizeMb} onChange={(e) => update("documentRequirements", i, { maxSizeMb: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Instructions (optional)"><Input value={r.description} onChange={(e) => update("documentRequirements", i, { description: e.target.value })} /></Field>
            <div className="flex flex-wrap items-center gap-x-6">
              <Checkbox label="Required" checked={r.isRequired} onChange={(e) => update("documentRequirements", i, { isRequired: e.target.checked })} />
              {(["pdf", "jpg", "png"] as const).map((f) => (
                <Checkbox key={f} label={f.toUpperCase()} checked={r.acceptedFormats.includes(f)} onChange={(e) => update("documentRequirements", i, { acceptedFormats: e.target.checked ? [...r.acceptedFormats, f] : r.acceptedFormats.filter((x) => x !== f) })} />
              ))}
            </div>
          </RowShell>
        ))}
        {err("documentRequirements") && <p role="alert" className="text-sm text-danger">{err("documentRequirements")?.[0]}</p>}
        <Button type="button" variant="outline" size="sm" onClick={() => setD((p) => ({ ...p, documentRequirements: [...p.documentRequirements, { name: "", description: "", isRequired: true, acceptedFormats: ["pdf", "jpg", "png"], maxSizeMb: 10 }] }))}><Plus className="size-4" />Add document</Button>
      </SectionCard>

      <SectionCard title="Application questions" hint="Package-specific questions asked in the application wizard. Add a condition to show a question only for certain answers.">
        {d.questions.map((q, i) => (
          <RowShell key={q.key ?? i} onRemove={() => remove("questions", i)}>
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <Field label="Question" error={err(`questions.${i}.label`)}><Input value={q.label} onChange={(e) => update("questions", i, { label: e.target.value })} /></Field>
              <Field label="Answer type"><Select value={q.type} onChange={(e) => update("questions", i, { type: e.target.value as QuestionType })}>{QUESTION_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>)}</Select></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Wizard section (optional)"><Input value={q.section} onChange={(e) => update("questions", i, { section: e.target.value })} placeholder="e.g. Employment / Education" /></Field>
              <Field label="Help text (optional)"><Input value={q.helpText} onChange={(e) => update("questions", i, { helpText: e.target.value })} /></Field>
            </div>
            {HAS_OPTIONS.includes(q.type) && (
              <Field label="Options (one per line)" error={err(`questions.${i}.options`)}>
                <Textarea className="min-h-24" value={q.options.map((o) => o.label).join("\n")} onChange={(e) => {
                  const old = new Map(q.options.map((o) => [o.label, o.value]));
                  update("questions", i, { options: e.target.value.split("\n").map((label) => ({ label, value: old.get(label) })) });
                }} />
              </Field>
            )}
            <Checkbox label="Required" checked={q.isRequired} onChange={(e) => update("questions", i, { isRequired: e.target.checked })} />
            <details className="rounded-xl border border-line bg-white p-3" open={!!q.condition}>
              <summary className="cursor-pointer text-sm font-medium">Conditional display</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Select aria-label="Depends on question" value={q.condition?.questionKey ?? ""} onChange={(e) => update("questions", i, { condition: e.target.value ? { questionKey: e.target.value, operator: q.condition?.operator ?? "equals", value: q.condition?.value ?? "" } : null })}>
                  <option value="">Always show</option>
                  {d.questions.filter((o, j) => j !== i && o.key).map((o) => <option key={o.key} value={o.key}>{o.label || o.key}</option>)}
                </Select>
                {q.condition && (
                  <>
                    <Select aria-label="Operator" value={q.condition.operator} onChange={(e) => update("questions", i, { condition: { ...q.condition!, operator: e.target.value as "equals" | "notEquals" | "in" } })}>
                      <option value="equals">equals</option><option value="notEquals">does not equal</option><option value="in">is one of (comma separated)</option>
                    </Select>
                    <Input aria-label="Value" value={Array.isArray(q.condition.value) ? q.condition.value.join(",") : q.condition.value} onChange={(e) => update("questions", i, { condition: { ...q.condition!, value: q.condition!.operator === "in" ? e.target.value.split(",").map((s) => s.trim()) : e.target.value } })} />
                  </>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-3">Only questions that have already been saved can be referenced. Save, then add the condition.</p>
            </details>
          </RowShell>
        ))}
        {err("questions") && <p role="alert" className="text-sm text-danger">{err("questions")?.[0]}</p>}
        <Button type="button" variant="outline" size="sm" onClick={() => setD((p) => ({ ...p, questions: [...p.questions, { label: "", helpText: "", type: "TEXT", isRequired: false, section: "", condition: null, options: [] }] }))}><Plus className="size-4" />Add question</Button>
      </SectionCard>

      <SectionCard title="FAQ, important information & terms">
        {d.faqs.map((f, i) => (
          <RowShell key={i} onRemove={() => remove("faqs", i)}>
            <Field label="Question"><Input value={f.question} onChange={(e) => update("faqs", i, { question: e.target.value })} /></Field>
            <Field label="Answer"><Textarea className="min-h-20" value={f.answer} onChange={(e) => update("faqs", i, { answer: e.target.value })} /></Field>
          </RowShell>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setD((p) => ({ ...p, faqs: [...p.faqs, { question: "", answer: "" }] }))}><Plus className="size-4" />Add FAQ</Button>
        <Field label="Important information" htmlFor="importantInfo"><Textarea id="importantInfo" value={d.importantInfo} onChange={(e) => set("importantInfo", e.target.value)} /></Field>
        <Field label="Terms" htmlFor="terms"><Textarea id="terms" className="min-h-32" value={d.terms} onChange={(e) => set("terms", e.target.value)} /></Field>
      </SectionCard>

      <SectionCard title="Publishing">
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Status" htmlFor="status" error={err("status")}>
            <Select id="status" value={d.status} onChange={(e) => set("status", e.target.value as PackageFormData["status"])}>
              <option value="DRAFT">Draft (hidden)</option><option value="ACTIVE">Active (public)</option><option value="INACTIVE">Inactive (hidden)</option>
            </Select>
          </Field>
          <Field label="Display order" htmlFor="displayOrder" hint="Lower numbers first"><Input id="displayOrder" type="number" min={0} value={d.displayOrder} onChange={(e) => set("displayOrder", Number(e.target.value))} /></Field>
          <div className="flex items-end"><Checkbox label="Featured on homepage" checked={d.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} /></div>
        </div>
      </SectionCard>

      <div className="sticky bottom-4 z-20 ml-auto w-fit">
        <Button type="submit" size="lg" disabled={pending} className="shadow-lift">{pending ? "Saving…" : id ? "Save changes" : "Create package"}</Button>
      </div>
    </form>
  );
}
