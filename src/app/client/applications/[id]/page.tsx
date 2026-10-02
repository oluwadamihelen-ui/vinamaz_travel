import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { ApplicationSummary } from "@/components/apply/summary";
import { DocumentSlot } from "@/components/apply/document-slot";
import { ProgressBar } from "@/components/apply/progress";
import { ApplicationTimeline } from "@/components/apply/timeline";
import { actionHref } from "@/components/apply/application-card";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
import { isTerminal, nextAction } from "@/lib/applications/next-action";
import { CLIENT_UPLOAD_STATUSES } from "@/lib/applications/status";
import { requireClientPage } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getApplicationView } from "@/lib/services/applications";

export const metadata: Metadata = { title: "Application" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const actor = await requireClientPage();
  const { id } = await params;
  let view;
  try {
    view = await getApplicationView(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { app, config, answers, steps, slots, currentDocs, progress, history } = view;
  const submitted = (await searchParams).submitted === "1";
  const flagged = currentDocs.filter((d) => d.status === "REJECTED" || d.status === "REPLACEMENT_REQUIRED");
  const action = nextAction({ status: app.status, progressPercent: app.progressPercent, documentsToReplace: flagged.map((d) => d.name) });
  const canUploadAny = !isTerminal(app.status) && (CLIENT_UPLOAD_STATUSES.includes(app.status) || flagged.length > 0);

  return (
    <div className="space-y-6">
      {submitted && <Alert tone="ok"><strong>Application submitted.</strong> Reference {app.applicationNumber}. We&rsquo;ll let you know about the next steps.</Alert>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{app.packageCountry}</p>
          <h1 className="mt-1 text-3xl font-semibold">{app.packageName}</h1>
          <p className="mt-1 text-sm text-ink-3">Application ID: <span className="font-medium text-ink">{app.applicationNumber}</span></p>
        </div>
        <Badge tone={STATUS_TONE[app.status]} className="px-3.5 py-1.5 text-sm">{STATUS_LABEL[app.status]}</Badge>
      </div>

      {action?.urgent && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold-bright/50 bg-gold-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
            <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-3">Next action</p><p className="font-semibold">{action.label}</p></div>
          </div>
          {action.target !== "detail" && <Button asChild><Link href={actionHref(app.id, action.target)}>{app.status === "DRAFT" ? "Continue application" : "Take action"}</Link></Button>}
        </div>
      )}

      <Card className="grid gap-6 p-6 sm:grid-cols-2">
        <div><p className="text-sm text-ink-3">Form completion</p><ProgressBar percent={progress.percent} className="mt-2" /></div>
        <div>
          <p className="text-sm text-ink-3">Processing status</p>
          <p className="mt-2 text-lg font-semibold">{STATUS_LABEL[app.status]}</p>
          {app.submittedAt && <p className="text-sm text-ink-3">Submitted {app.submittedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card className="p-6 sm:p-8">
          <h2 className="mb-6 text-2xl font-semibold">Progress</h2>
          <ApplicationTimeline status={app.status} history={history} />
        </Card>

        <div className="space-y-6">
          {slots.length > 0 && (
            <Card id="documents" className="scroll-mt-24 p-6 sm:p-8">
              <h2 className="mb-1 text-2xl font-semibold">Documents</h2>
              <p className="mb-5 text-sm text-ink-3">Your files are stored privately and only visible to you and authorised Vinamaz staff.</p>
              <div className="space-y-4">
                {slots.map((slot) => {
                  const cur = currentDocs.find((d) => d.requirementKey === slot.key);
                  const flaggedDoc = cur && (cur.status === "REJECTED" || cur.status === "REPLACEMENT_REQUIRED");
                  return (
                    <DocumentSlot
                      key={slot.key} applicationId={app.id} slot={slot}
                      canUpload={!isTerminal(app.status) && (CLIENT_UPLOAD_STATUSES.includes(app.status) || !!flaggedDoc)}
                      current={cur ? { id: cur.id, originalFilename: cur.originalFilename, sizeBytes: cur.sizeBytes, status: cur.status, rejectionReason: cur.rejectionReason } : null}
                    />
                  );
                })}
              </div>
              {!canUploadAny && app.status !== "DRAFT" && <p className="mt-4 text-sm text-ink-3">Document uploads are closed unless we ask you for an update.</p>}
            </Card>
          )}
          <details className="rounded-2xl border border-line bg-white shadow-card">
            <summary className="cursor-pointer list-none p-5 text-lg font-semibold">Your application details</summary>
            <div className="border-t border-line p-6 sm:p-8">
              <ApplicationSummary applicant={(app.applicant ?? {}) as Record<string, unknown>} steps={steps} questions={config.questions} answers={answers} slots={slots} docs={currentDocs} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
