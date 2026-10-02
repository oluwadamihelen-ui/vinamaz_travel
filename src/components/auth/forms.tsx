"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert } from "@/components/ui/misc";
import { forgotPasswordAction, loginAction, registerAction, resetPasswordAction, type FormState } from "@/lib/actions/auth";
import { COUNTRIES } from "@/lib/countries";

const initial: FormState = {};

function useRedirectOnSuccess(state: FormState) {
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(loginAction, initial);
  useRedirectOnSuccess(state);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="space-y-5" noValidate>
      {notice && <Alert tone="ok">{notice}</Alert>}
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email address" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="password" className="text-sm font-medium">Password</label>
          <Link href="/forgot-password" className="text-sm font-medium text-brand hover:underline">Forgot password?</Link>
        </div>
        <PasswordInput id="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state.redirectTo}>{pending || state.redirectTo ? "Signing in…" : "Sign in"}</Button>
      <p className="text-center text-sm text-ink-3">
        New to Vinamaz? <Link className="font-semibold text-brand hover:underline" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(registerAction, initial);
  useRedirectOnSuccess(state);
  const e = state.fieldErrors ?? {};
  // Controlled so a validation error never wipes what the user typed.
  const [v, setV] = useState({ name: "", email: "", phone: "", countryOfResidence: "Nigeria", password: "", confirmPassword: "", whatsapp: "", nationality: "", dateOfBirth: "" });
  const set = (k: keyof typeof v) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: ev.target.value }));
  const mismatch = v.confirmPassword.length > 0 && v.password !== v.confirmPassword;

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Full name" htmlFor="name" error={e.name}><Input id="name" name="name" autoComplete="name" required aria-invalid={!!e.name} value={v.name} onChange={set("name")} /></Field>
      <Field label="Email address" htmlFor="email" error={e.email}><Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!e.email} value={v.email} onChange={set("email")} /></Field>
      <Field label="Phone number" htmlFor="phone" error={e.phone} hint="Include your country code, e.g. +234…"><Input id="phone" name="phone" type="tel" autoComplete="tel" required aria-invalid={!!e.phone} value={v.phone} onChange={set("phone")} /></Field>
      <Field label="Country of residence" htmlFor="countryOfResidence" error={e.countryOfResidence}>
        <Select id="countryOfResidence" name="countryOfResidence" value={v.countryOfResidence} onChange={set("countryOfResidence")} required>
          {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Password" htmlFor="password" error={e.password} hint="At least 10 characters, with letters and numbers.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required aria-invalid={!!e.password} value={v.password} onChange={set("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" error={e.confirmPassword ?? (mismatch ? ["Passwords do not match"] : undefined)}>
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required aria-invalid={!!e.confirmPassword || mismatch} value={v.confirmPassword} onChange={set("confirmPassword")} />
      </Field>
      <details className="rounded-xl border border-line bg-white/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">Optional details</summary>
        <div className="mt-4 space-y-4">
          <Field label="WhatsApp number" htmlFor="whatsapp" error={e.whatsapp}><Input id="whatsapp" name="whatsapp" type="tel" value={v.whatsapp} onChange={set("whatsapp")} /></Field>
          <Field label="Nationality" htmlFor="nationality"><Input id="nationality" name="nationality" value={v.nationality} onChange={set("nationality")} /></Field>
          <Field label="Date of birth" htmlFor="dateOfBirth" error={e.dateOfBirth}><Input id="dateOfBirth" name="dateOfBirth" type="date" value={v.dateOfBirth} onChange={set("dateOfBirth")} /></Field>
        </div>
      </details>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state.redirectTo}>{pending || state.redirectTo ? "Creating account…" : "Create account"}</Button>
      <p className="text-center text-sm text-ink-3">
        Already registered? <Link className="font-semibold text-brand hover:underline" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, {} as FormState & { sent?: boolean });
  const [email, setEmail] = useState("");
  if (state.sent) {
    return (
      <div className="space-y-5">
        <Alert tone="ok">If an account exists for <strong>{email}</strong>, we&rsquo;ve sent a password reset link. It expires in 60 minutes. Check your spam folder if it doesn&rsquo;t arrive.</Alert>
        <Link href="/login" className="inline-block text-sm font-semibold text-brand hover:underline">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Email address" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
      <p className="text-center text-sm"><Link href="/login" className="font-semibold text-brand hover:underline">Back to sign in</Link></p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction.bind(null, token), initial);
  useRedirectOnSuccess(state);
  const e = state.fieldErrors ?? {};
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && password !== confirm;
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error} {!Object.keys(e).length && <Link href="/forgot-password" className="font-semibold underline">Request a new link</Link>}</Alert>}
      <Field label="New password" htmlFor="password" error={e.password} hint="At least 10 characters, with letters and numbers.">
        <PasswordInput id="password" name="password" autoComplete="new-password" required value={password} onChange={(ev) => setPassword(ev.target.value)} aria-invalid={!!e.password} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={e.confirmPassword ?? (mismatch ? ["Passwords do not match"] : undefined)}>
        <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required value={confirm} onChange={(ev) => setConfirm(ev.target.value)} aria-invalid={!!e.confirmPassword || mismatch} />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state.redirectTo}>{pending || state.redirectTo ? "Updating…" : "Update password"}</Button>
    </form>
  );
}
