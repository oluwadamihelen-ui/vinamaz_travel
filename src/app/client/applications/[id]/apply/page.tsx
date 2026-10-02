import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check } from "lucide-react";
import { ApplicationSummary } from "@/components/apply/summary";
import { DocumentSlot } from "@/components/apply/document-slot";
import { ProgressBar } from "@/components/apply/progress";
import { StepForm } from "@/components/apply/step-form";
import { SubmitForm } from "@/components/apply/submit-form";
import { Card } from "@/components/ui/misc";
import { questionsForStep } from "@/lib/applications/engine";
import { CLIENT_UPLOAD_STATUSES } from "@/lib/applications/status";
import { requireClientPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getApplicationView } from "@/lib/services/applications";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

export default async function ApplyWizardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const actor = await requireClientPage();
  const { id } = await params;
  let view;
  try {
    view = await getApplicationView(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { app, config, answers, steps, slots, currentDocs, progress } = view;
  if (app.status !== "DRAFT") redirect(`/client/applications/${app.id}`);

  const requested = (await searchParams).step ?? app.currentStep ?? "details";
  const idx = Math.max(0, steps.findIndex((s) => s.key === requested));
  const step = steps[idx]!;
  const base = `/client/applications/${app.id}/apply`;
  const applicant = (app.applicant ?? {}) as Record<string, string | null>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{app.packageCountry} · {app.applicationNumber}</p>
        <h1 className="mt-1 text-3xl font-semibold">{app.packageName}</h1>
      </div>
      <ProgressBar percent={progress.percent} />

      <nav aria-label="Application steps" className="-mx-5 overflow-x-auto px-5">
        <ol className="flex min-w-max gap-2 pb-1 text-sm">
          {steps.map((s, i) => (
            <li key={s.key}>
              <Link href={`${base}?step=${s.key}`} aria-current={i === idx ? "step" : undefined}
                className={cn("flex min-h-11 items-center gap-2 rounded-full border px-4 font-medium", i === idx ? "border-ink bg-ink text-white" : i < idx ? "border-brand/30 bg-brand-soft text-brand" : "border-line bg-white text-ink-3")}>
                {i < idx ? <Check className="size-4" /> : <span className="text-xs">{i + 1}</span>}{s.title}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <Card className="p-6 sm:p-8">
        <p className="text-sm text-ink-3">Step {idx + 1} of {steps.length}</p>
        <h2 className="mb-6 text-2xl font-semibold">{step.title}</h2>

        {step.kind === "review" ? (
          <div className="space-y-8">
            <ApplicationSummary applicant={applicant} steps={steps} questions={config.questions} answers={answers} slots={slots} docs={currentDocs} />
            <SubmitForm applicationId={app.id} stepLinks={steps.filter((s) => s.kind !== "review").map((s) => ({ href: `${base}?step=${s.key}`, title: s.title }))} />
            <Link href={`${base}?step=${steps[idx - 1]!.key}`} className="inline-block text-sm font-medium text-brand hover:underline">← Back</Link>
          </div>
        ) : (
          <StepForm
            key={step.key}
            applicationId={app.id} stepKey={step.key} kind={step.kind}
            applicant={applicant} questions={questionsForStep(step, config.questions)} allQuestions={config.questions} answers={answers}
            backHref={idx > 0 ? `${base}?step=${steps[idx - 1]!.key}` : null} isLast={steps[idx + 1]?.kind === "review"}
          >
            {step.kind === "documents" && slots.map((slot) => {
              const cur = currentDocs.find((d) => d.requirementKey === slot.key);
              return (
                <DocumentSlot key={slot.key} applicationId={app.id} slot={slot} canUpload={CLIENT_UPLOAD_STATUSES.includes(app.status)}
                  current={cur ? { id: cur.id, originalFilename: cur.originalFilename, sizeBytes: cur.sizeBytes, status: cur.status, rejectionReason: cur.rejectionReason } : null} />
              );
            })}
          </StepForm>
        )}
      </Card>
    </div>
  );
}
