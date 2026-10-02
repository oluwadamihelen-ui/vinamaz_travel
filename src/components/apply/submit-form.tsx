"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { submitApplicationAction, type WizardState } from "@/lib/actions/applications";

export function SubmitForm({ applicationId, stepLinks }: { applicationId: string; stepLinks: { href: string; title: string }[] }) {
  const [state, action, pending] = useActionState(submitApplicationAction.bind(null, applicationId), {} as WizardState);
  const problems = state.fieldErrors ? Object.values(state.fieldErrors) : [];
  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <Alert>
          <p>{state.error}</p>
          {problems.length > 0 && <ul className="mt-2 list-disc pl-5">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>}
          {problems.length > 0 && (
            <p className="mt-2">Go back to: {stepLinks.map((s, i) => <span key={s.href}>{i > 0 && ", "}<Link className="underline" href={s.href}>{s.title}</Link></span>)}</p>
          )}
        </Alert>
      )}
      <Checkbox name="confirm" label="I confirm that the information and documents I have provided are accurate and complete." />
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>{pending ? "Submitting…" : "Submit application"}</Button>
      <p className="text-xs text-ink-3">Vinamaz provides application support. Submitting does not guarantee a visa; decisions are made by the relevant authority.</p>
    </form>
  );
}
