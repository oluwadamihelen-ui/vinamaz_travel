"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";
import { registerClient } from "@/lib/services/users";
import { loginSchema } from "@/lib/validation/auth";

export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set on success. The client performs a full-page navigation so the new session cookie
   *  is sent with the very first request (a server-action redirect would render the target
   *  with the old, cookie-less request and bounce back to /login). */
  redirectTo?: string;
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`register:${ip}`, 10, 60 * 60 * 1000).ok) {
    return { error: "Too many attempts. Please try again later." };
  }
  const raw = Object.fromEntries(formData.entries());
  try {
    await registerClient(raw);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors };
    console.error("[register]", e);
    return { error: "We couldn't create your account. Please try again." };
  }
  const next = safeNext(raw.next, "/client/dashboard");
  try {
    await signIn("credentials", { email: raw.email, password: raw.password, redirect: false });
  } catch {
    return { redirectTo: "/login" };
  }
  return { redirectTo: next };
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { error: "Enter your email and password." };
  const next = safeNext(raw.next, "");
  try {
    await signIn("credentials", { email: parsed.data.email, password: parsed.data.password, redirect: false });
  } catch (e) {
    if (e instanceof AuthError) return { error: "Incorrect email or password, or too many attempts. Please try again." };
    console.error("[login]", e);
    return { error: "We couldn't sign you in. Please try again." };
  }
  return { redirectTo: next || "/client/dashboard" }; // proxy re-routes staff to /admin
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}
