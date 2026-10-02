"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/** On phones the filter form folds away behind a button (open when filters are active); on large screens it is always shown. */
export function CollapsibleFilters({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls="filters-panel" onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center justify-between rounded-xl text-left font-medium lg:hidden">
        <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" aria-hidden />Search &amp; filters{activeCount > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white">{activeCount}</span>}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id="filters-panel" className={cn(open ? "mt-3 block" : "hidden", "lg:mt-0 lg:block")}>{children}</div>
    </div>
  );
}
