"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { loginAction, registerAction, type FormState } from "@/lib/actions/auth";
import { COUNTRIES } from "@/lib/countries";

const initial: FormState = {};

function useRedirectOnSuccess(state: FormState) {
  useEffect(() => {
    if (state.redirectTo) window.location.assign(state.redirectTo);
  }, [state.redirectTo]);
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, initial);
  useRedirectOnSuccess(state);
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email address" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state.redirectTo}>{pending || state.redirectTo ? "Signing in…" : "Sign in"}</Button>
      <p className="text-center text-sm text-ink-3">
        New to Vinamaz? <Link className="font-semibold text-teal hover:underline" href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(registerAction, initial);
  useRedirectOnSuccess(state);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Full name" htmlFor="name" error={e.name}><Input id="name" name="name" autoComplete="name" required aria-invalid={!!e.name} /></Field>
      <Field label="Email address" htmlFor="email" error={e.email}><Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!e.email} /></Field>
      <Field label="Phone number" htmlFor="phone" error={e.phone} hint="Include your country code, e.g. +234…"><Input id="phone" name="phone" type="tel" autoComplete="tel" required aria-invalid={!!e.phone} /></Field>
      <Field label="Country of residence" htmlFor="countryOfResidence" error={e.countryOfResidence}>
        <Select id="countryOfResidence" name="countryOfResidence" defaultValue="Nigeria" required>
          {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Password" htmlFor="password" error={e.password} hint="At least 10 characters, with letters and numbers."><Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!e.password} /></Field>
      <details className="rounded-xl border border-line bg-white/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">Optional details</summary>
        <div className="mt-4 space-y-4">
          <Field label="WhatsApp number" htmlFor="whatsapp" error={e.whatsapp}><Input id="whatsapp" name="whatsapp" type="tel" /></Field>
          <Field label="Nationality" htmlFor="nationality"><Input id="nationality" name="nationality" /></Field>
          <Field label="Date of birth" htmlFor="dateOfBirth" error={e.dateOfBirth}><Input id="dateOfBirth" name="dateOfBirth" type="date" /></Field>
        </div>
      </details>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !!state.redirectTo}>{pending || state.redirectTo ? "Creating account…" : "Create account"}</Button>
      <p className="text-center text-sm text-ink-3">
        Already registered? <Link className="font-semibold text-teal hover:underline" href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
      </p>
    </form>
  );
}
