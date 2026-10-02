import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/apply/progress";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/applications/labels";
import type { ApplicationStatus } from "@/generated/prisma/enums";

export interface ApplicationCardData {
  id: string; applicationNumber: string; packageName: string; packageCountry: string;
  status: ApplicationStatus; progressPercent: number; updatedAt: Date;
}

export function ApplicationCard({ app }: { app: ApplicationCardData }) {
  const draft = app.status === "DRAFT";
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{app.packageCountry}</p>
          <h2 className="mt-1 text-xl font-semibold">{app.packageName}</h2>
          <p className="mt-1 text-sm text-ink-3">{app.applicationNumber} · Updated {app.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
        <Badge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Badge>
      </div>
      {draft && <ProgressBar percent={app.progressPercent} className="mt-5" />}
      <div className="mt-5">
        {draft ? (
          <Button asChild><Link href={`/client/applications/${app.id}/apply`}>Continue application <ArrowRight className="size-4" /></Link></Button>
        ) : (
          <Button asChild variant="outline"><Link href={`/client/applications/${app.id}`}>View application</Link></Button>
        )}
      </div>
    </Card>
  );
}
