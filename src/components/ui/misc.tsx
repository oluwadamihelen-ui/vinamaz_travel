import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-sand text-ink-3",
      gold: "bg-gold-soft text-gold",
      teal: "bg-teal-soft text-teal",
      ok: "bg-ok-soft text-ok",
      danger: "bg-danger-soft text-danger",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-white shadow-card", className)} {...p} />;
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "ok"; children: React.ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl px-4 py-3 text-sm", tone === "danger" ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok")}>
      {children}
    </div>
  );
}
