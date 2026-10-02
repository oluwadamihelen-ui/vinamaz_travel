"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Sign-in / portal buttons. Resolved in the browser so the surrounding public pages can be served from cache. */
export function HeaderActions() {
  const [portal, setPortal] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { portal?: string | null } | null) => { if (!cancelled && j?.portal) setPortal(j.portal); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="flex items-center gap-2">
      {portal ? (
        <Button asChild size="sm"><Link href={portal}>My portal</Link></Button>
      ) : (
        <>
          <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex"><Link href="/login">Sign in</Link></Button>
          <Button asChild size="sm"><Link href="/register">Create account</Link></Button>
        </>
      )}
    </div>
  );
}
