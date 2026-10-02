import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationSummary } from "@/components/apply/summary";
import { ProgressBar } from "@/components/apply/progress";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card } from "@/components/ui/misc";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
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
  const { app, config, answers, steps, slots, currentDocs, progress } = view;
  const submitted = (await searchParams).submitted === "1";

  return (
    <div className="space-y-6">
      {submitted && <Alert tone="ok"><strong>Application submitted.</strong> Reference {app.applicationNumber}. We&rsquo;ll let you know about the next steps.</Alert>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{app.packageCountry} · {app.applicationNumber}</p>
          <h1 className="mt-1 text-3xl font-semibold">{app.packageName}</h1>
        </div>
        <Badge tone={STATUS_TONE[app.status]} className="px-3.5 py-1.5 text-sm">{STATUS_LABEL[app.status]}</Badge>
      </div>

      <Card className="grid gap-6 p-6 sm:grid-cols-2">
        <div>
          <p className="text-sm text-ink-3">Form completion</p>
          <ProgressBar percent={progress.percent} className="mt-2" />
        </div>
        <div>
          <p className="text-sm text-ink-3">Processing status</p>
          <p className="mt-2 text-lg font-semibold">{STATUS_LABEL[app.status]}</p>
          {app.submittedAt && <p className="text-sm text-ink-3">Submitted {app.submittedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>}
        </div>
      </Card>

      {app.status === "DRAFT" && (
        <Button asChild size="lg"><Link href={`/client/applications/${app.id}/apply`}>Continue application</Link></Button>
      )}

      <Card className="p-6 sm:p-8">
        <ApplicationSummary applicant={(app.applicant ?? {}) as Record<string, unknown>} steps={steps} questions={config.questions} answers={answers} slots={slots} docs={currentDocs} />
      </Card>
    </div>
  );
}
