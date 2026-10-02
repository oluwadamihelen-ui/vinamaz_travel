import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, MessageSquare } from "lucide-react";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/apply/progress";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
import type { NextAction } from "@/lib/applications/next-action";
import type { ApplicationStatus } from "@/generated/prisma/enums";

export interface ApplicationCardData {
  id: string; paymentId?: string | null; applicationNumber: string; packageName: string; packageCountry: string;
  status: ApplicationStatus; progressPercent: number; updatedAt: Date;
  action?: NextAction | null;
  unreadMessages?: number;
}

export function actionHref(id: string, target: NextAction["target"], paymentId?: string | null): string {
  switch (target) {
    case "payment": return paymentId ? `/client/payments/${paymentId}` : `/client/payments`;
    case "wizard": return `/client/applications/${id}/apply`;
    case "documents": return `/client/applications/${id}#documents`;
    default: return `/client/applications/${id}`;
  }
}

/** One application: status, form completion (drafts) and the next thing the client should do. */
export function ApplicationCard({ app, highlight = false }: { app: ApplicationCardData; highlight?: boolean }) {
  const draft = app.status === "DRAFT";
  const action = app.action;
  return (
    <Card className={highlight ? "border-gold-bright/50 p-6 shadow-lift sm:p-8" : "p-6"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{app.packageCountry}</p>
          <h2 className={highlight ? "mt-1 text-2xl font-semibold" : "mt-1 text-xl font-semibold"}>{app.packageName}</h2>
          <p className="mt-1 text-sm text-ink-3">
            Application ID: <span className="font-medium text-ink">{app.applicationNumber}</span> · Updated {app.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <Badge tone={STATUS_TONE[app.status]} className={highlight ? "px-3.5 py-1.5 text-sm" : undefined}>{STATUS_LABEL[app.status]}</Badge>
      </div>

      {draft && <ProgressBar percent={app.progressPercent} className="mt-5" />}

      {action && (
        <div className={`mt-5 flex items-start gap-3 rounded-2xl px-4 py-3 text-[15px] ${action.urgent ? "bg-gold-soft" : "bg-paper"}`}>
          {action.urgent ? <AlertCircle className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{action.urgent ? "Next action" : "Status"}</p>
            <p className="font-medium">{action.label}</p>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        {action?.urgent && action.target !== "detail" ? (
          <Button asChild><Link href={actionHref(app.id, action.target, app.paymentId)}>{draft ? "Continue application" : action.target === "payment" ? "Pay now" : "Take action"} <ArrowRight className="size-4" /></Link></Button>
        ) : draft ? (
          <Button asChild><Link href={`/client/applications/${app.id}/apply`}>Continue application <ArrowRight className="size-4" /></Link></Button>
        ) : null}
        {!draft && <Button asChild variant="outline"><Link href={`/client/applications/${app.id}`}>View application</Link></Button>}
        {!draft && (app.unreadMessages ?? 0) > 0 && <Button asChild variant="ghost"><Link href={`/client/applications/${app.id}#messages`}><MessageSquare className="size-4" />{app.unreadMessages} new message{app.unreadMessages === 1 ? "" : "s"}</Link></Button>}
      </div>
    </Card>
  );
}
