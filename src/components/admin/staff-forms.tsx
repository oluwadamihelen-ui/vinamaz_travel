"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { createStaffAction, resendInviteAction, updateStaffAction, type AdminActionState } from "@/lib/actions/admin-applications";

const init: AdminActionState = {};

const LABEL: Record<string, string> = {
  "packages.view": "View packages", "packages.manage": "Manage packages",
  "applications.view": "View applications", "applications.manage": "Add notes / manage applications", "applications.assign": "Assign applications", "applications.status_update": "Change application status",
  "documents.view": "View documents", "documents.review": "Review documents",
  "payments.view": "View payments", "payments.manage": "Manage payments", "payments.refund": "Refund payments",
  "staff.manage": "Manage staff accounts", "clients.view": "View clients", "clients.manage": "Manage clients",
  "messages.view": "View messages", "messages.manage": "Send messages",
  "notifications.view": "View notifications", "notifications.manage": "Manage notifications", "audit.view": "View audit log",
};

function PermissionBoxes({ all, selected }: { all: readonly string[]; selected?: readonly string[] }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">Permissions</legend>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {all.map((p) => <Checkbox key={p} name="permissions" value={p} defaultChecked={selected?.includes(p)} label={LABEL[p] ?? p} />)}
      </div>
    </fieldset>
  );
}

export function CreateStaffForm({ permissions, canCreateAdmin }: { permissions: readonly string[]; canCreateAdmin: boolean }) {
  const [state, action, pending] = useActionState(createStaffAction, init);
  const fe = state.fieldErrors ?? {};
  return (
    <form key={state.ok ? "done" : "form"} action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok"><span className="break-all">{state.message}</span></Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name" error={fe.name}><Input id="name" name="name" required /></Field>
        <Field label="Email" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" required /></Field>
        <Field label="Role" htmlFor="role" hint="Admins can see all applications. Staff only see applications assigned to them."><Select id="role" name="role" defaultValue="STAFF"><option value="STAFF">Staff</option>{canCreateAdmin && <option value="ADMIN">Admin</option>}</Select></Field>
      </div>
      <PermissionBoxes all={permissions} selected={["applications.view", "documents.view"]} />
      <p className="text-xs text-ink-3">The new member receives an email to choose their own password. Admins already include most operational permissions.</p>
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create account & send invite"}</Button>
    </form>
  );
}

function ResendInvite({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<AdminActionState>({});
  return (
    <div className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok"><span className="break-all">{state.message}</span></Alert>}
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setState(await resendInviteAction(userId)))}>{pending ? "Sending…" : "Send a new invitation"}</Button>
    </div>
  );
}

export function EditStaffForm({ userId, permissions, selected, isActive, role, canResend, editable = true }: { userId: string; permissions: readonly string[]; selected: readonly string[]; isActive: boolean; role: string; canResend?: boolean; editable?: boolean }) {
  const [state, action, pending] = useActionState(updateStaffAction.bind(null, userId), init);
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.message}</Alert>}
      {role === "ADMIN" && <p className="text-xs text-ink-3">Admins already have the standard operational permissions; extra ticks add to them.</p>}
      <PermissionBoxes all={permissions} selected={selected} />
      <Checkbox name="isActive" label="Account active" defaultChecked={isActive} />
      <Button type="submit" size="sm" disabled={pending || !editable}>{pending ? "Saving…" : "Save changes"}</Button>
      {canResend && <div className="border-t border-line pt-3"><p className="mb-2 text-xs text-ink-3">This person hasn&rsquo;t signed in yet.</p><ResendInvite userId={userId} /></div>}
    </form>
  );
}
