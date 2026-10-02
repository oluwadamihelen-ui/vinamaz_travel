import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildTimelineEvents, buildTimelineStages, type HistoryEntry } from "@/lib/applications/timeline";
import type { ApplicationStatus } from "@/generated/prisma/enums";

const fmt = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Seven-stage progress timeline plus the chronological list of updates (with staff messages). */
export function ApplicationTimeline({ status, history }: { status: ApplicationStatus; history: HistoryEntry[] }) {
  const { stages, cancelled } = buildTimelineStages(status, history);
  const events = buildTimelineEvents(history);
  return (
    <div className="space-y-8">
      {cancelled && <p className="rounded-xl bg-sand px-4 py-3 text-sm font-medium text-ink-2">This application was cancelled.</p>}
      <ol aria-label="Application progress" className="relative space-y-0">
        {stages.map((s, i) => {
          const last = i === stages.length - 1;
          return (
            <li key={s.key} className="relative flex gap-4 pb-7 last:pb-0" aria-current={s.state === "current" ? "step" : undefined}>
              {!last && <span aria-hidden className={cn("absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5", s.state === "done" ? "bg-brand" : "bg-line")} />}
              <span
                aria-hidden
                className={cn(
                  "z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold",
                  s.state === "done" && "border-brand bg-brand text-white",
                  s.state === "current" && "border-gold-bright bg-gold-bright text-ink shadow-[0_0_0_6px_rgb(217_154_28/0.2)]",
                  s.state === "upcoming" && "border-line bg-white text-ink-3",
                )}
              >
                {s.state === "done" ? <Check className="size-4" /> : s.state === "current" ? "●" : "○"}
              </span>
              <div className={cn("min-w-0 flex-1 rounded-2xl", s.state === "current" && "-mt-1 border border-gold-bright/40 bg-gold-soft/50 px-4 py-3")}>
                <p className={cn("font-semibold", s.state === "upcoming" && "text-ink-3", s.state === "current" && "text-lg")}>
                  {s.title}
                  <span className="sr-only"> ({s.state === "done" ? "completed" : s.state === "current" ? "current stage" : "upcoming"})</span>
                </p>
                <p className={cn("text-sm", s.state === "upcoming" ? "text-ink-3/70" : "text-ink-3")}>{s.description}</p>
                {s.at && <p className="mt-0.5 text-xs text-ink-3">{fmt(s.at)}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <section aria-label="Updates">
        <h3 className="text-lg font-semibold">Updates</h3>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
          {events.map((e, i) => (
            <li key={i} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{e.title}</p>
                <p className="text-xs text-ink-3">{fmt(e.at)}</p>
              </div>
              <p className="text-sm text-ink-3">{e.description}</p>
              {e.message && <p className="mt-2 rounded-xl bg-paper px-3 py-2 text-sm"><span className="font-medium">Message from Vinamaz:</span> {e.message}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
