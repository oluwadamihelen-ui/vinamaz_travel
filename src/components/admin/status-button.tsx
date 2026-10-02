"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setPackageStatusAction } from "@/lib/actions/packages";

export function StatusButton({ id, status, label }: { id: string; status: "ACTIVE" | "INACTIVE" | "DRAFT"; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant={status === "ACTIVE" ? "primary" : "ghost"}
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          try { await setPackageStatusAction(id, status); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
        })}
      >
        {pending ? "…" : label}
      </Button>
      {error && <span role="alert" className="mt-1 text-xs text-danger">{error}</span>}
    </span>
  );
}
