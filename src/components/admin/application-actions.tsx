"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select, Textarea, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import {
  addNoteAction, assignAction, changeStatusAction, reviewDocumentAction, type AdminActionState,
} from "@/lib/actions/admin-applications";
import { APPLICATION_STATUSES, STATUS_LABEL } from "@/lib/applications/labels";
import type { ApplicationStatus } from "@/generated/prisma/enums";

const init: AdminActionState = {};

function Feedback({ state }: { state: AdminActionState }) {
  if (state.error) return <Alert>{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="ok">{state.message}</Alert>;
  return null;
}

export function StatusForm({ applicationId, current, allowed, canOverride }: { applicationId: string; current: ApplicationStatus; allowed: readonly ApplicationStatus[]; canOverride: boolean }) {
  const [state, action, pending] = useActionState(changeStatusAction.bind(null, applicationId), init);
  const [override, setOverride] = useState(false);
  const options = override ? APPLICATION_STATUSES.filter((s) => s !== current) : allowed;
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <Field label="Change status to" htmlFor="to" error={fe.to}>
        <Select id="to" name="to" key={String(override)} defaultValue="" required>
          <option value="" disabled>{options.length ? "Select a status" : "No normal transitions available"}</option>
          {options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </Field>
      <Field label="Message to the client (optional)" htmlFor="note" error={fe.note} hint="Shown on the client's timeline. Don't include internal comments here; use Internal notes for those.">
        <Textarea id="note" name="note" className="min-h-24" maxLength={1000} />
      </Field>
      {canOverride && (
        <div className="rounded-xl border border-line bg-paper p-3">
          <Checkbox name="override" label="Override the normal workflow (recorded in the history)" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          {override && <p className="mt-1 text-xs text-ink-3">A message explaining why is required.</p>}
        </div>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Updating…" : "Update status"}</Button>
    </form>
  );
}

export function AssignForm({ applicationId, staff, currentId }: { applicationId: string; staff: { id: string; name: string; role: string }[]; currentId: string | null }) {
  const [state, action, pending] = useActionState(assignAction.bind(null, applicationId), init);
  return (
    <form action={action} className="space-y-3">
      <Feedback state={state} />
      <Field label="Assigned to" htmlFor="staffId">
        <Select id="staffId" name="staffId" defaultValue={currentId ?? ""}>
          <option value="">Unassigned</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.toLowerCase().replace("_", " ")})</option>)}
        </Select>
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? "Saving…" : "Save assignment"}</Button>
    </form>
  );
}

export function NoteForm({ applicationId }: { applicationId: string }) {
  const [state, action, pending] = useActionState(addNoteAction.bind(null, applicationId), init);
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-3">
      <Feedback state={state} />
      <Field label="Add an internal note" htmlFor="body" hint="Only staff can see notes. Clients never do." error={state.fieldErrors?.body}>
        <Textarea id="body" name="body" required maxLength={5000} />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add note"}</Button>
    </form>
  );
}

/** Review controls for one (current) document. */
export function DocumentReviewControls({ applicationId, documentId, status }: { applicationId: string; documentId: string; status: string }) {
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<null | "request_replacement" | "reject">(null);
  const [aState, approve, aPending] = useActionState(reviewDocumentAction.bind(null, applicationId, documentId, "approve"), init);
  const [sState, startReview, sPending] = useActionState(reviewDocumentAction.bind(null, applicationId, documentId, "start_review"), init);
  const [rState, reviewWithReason, rPending] = useActionState(reviewDocumentAction.bind(null, applicationId, documentId, mode ?? "request_replacement"), init);
  const busy = aPending || sPending || rPending;
  const state = [rState, aState, sState].find((s) => s.error) ?? [rState, aState, sState].find((s) => s.ok) ?? init;

  return (
    <div className="mt-3 space-y-3">
      <Feedback state={state} />
      <div className="flex flex-wrap gap-2">
        {status !== "APPROVED" && <form action={approve}><Button type="submit" size="sm" disabled={busy}>Approve</Button></form>}
        {status === "UPLOADED" && <form action={startReview}><Button type="submit" size="sm" variant="ghost" disabled={busy}>Mark under review</Button></form>}
        <Button type="button" size="sm" variant="outline" onClick={() => setMode(mode === "request_replacement" ? null : "request_replacement")}>Request replacement</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setMode(mode === "reject" ? null : "reject")}>Reject</Button>
      </div>
      {mode && (
        <form action={reviewWithReason} className="space-y-2 rounded-xl border border-line bg-paper p-3">
          <Field label={mode === "reject" ? "Why is this document rejected?" : "What should the client fix?"} htmlFor={`reason-${documentId}`} error={rState.fieldErrors?.reason} hint="The client will see this reason.">
            <Input id={`reason-${documentId}`} name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          </Field>
          <Button type="submit" size="sm" disabled={busy}>{mode === "reject" ? "Reject document" : "Send replacement request"}</Button>
        </form>
      )}
    </div>
  );
}
