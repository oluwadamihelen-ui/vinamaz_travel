import { cn } from "@/lib/utils";

/** Form-completion bar (not processing status). */
export function ProgressBar({ percent, label = "complete", className }: { percent: number; label?: string; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-medium">{percent}% {label}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-sand" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Application form completion">
        <div className={cn("h-full rounded-full bg-gradient-to-r from-teal to-gold-bright transition-all duration-700")} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
