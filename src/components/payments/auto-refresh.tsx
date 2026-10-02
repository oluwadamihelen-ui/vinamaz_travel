"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-checks the server a few times while we wait for the gateway to confirm (webhook / verification lag). */
export function AutoRefresh({ everyMs = 4000, times = 8 }: { everyMs?: number; times?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => { if (++n > times) clearInterval(t); else router.refresh(); }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, times]);
  return null;
}
