import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5", className)} aria-label="Vinamaz home">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="15" fill={dark ? "#d4a24c" : "#0b1b33"} />
        <path d="M8 11l8 11 8-11" fill="none" stroke={dark ? "#0b1b33" : "#d4a24c"} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="9" r="1.7" fill={dark ? "#0b1b33" : "#d4a24c"} />
      </svg>
      <span className={cn("font-display text-[22px] font-semibold tracking-[0.12em]", dark ? "text-white" : "text-ink")}>VINAMAZ</span>
    </Link>
  );
}
