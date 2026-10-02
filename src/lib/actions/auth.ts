"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-redirect";
import { registerClient } from "@/lib/services/users";
import { requestPasswordReset, resetPassword } from "@/lib/services/password-reset";
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

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Always reports success, whether or not the email has an account (no user enumeration). */
export async function forgotPasswordAction(_prev: FormState & { sent?: boolean }, formData: FormData): Promise<FormState & { sent?: boolean }> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };
  const ip = await clientIp();
  if (!rateLimit(`forgot:ip:${ip}`, 10, 60 * 60 * 1000).ok || !rateLimit(`forgot:email:${email}`, 3, 60 * 60 * 1000).ok) {
    return { error: "Too many requests. Please try again later." };
  }
  try {
    await requestPasswordReset(email);
  } catch (e) {
    console.error("[forgot-password]", e); // still report success: never reveal account state
  }
  return { sent: true };
}

export async function resetPasswordAction(token: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!rateLimit(`reset:ip:${await clientIp()}`, 20, 60 * 60 * 1000).ok) return { error: "Too many attempts. Please try again later." };
  try {
    await resetPassword(token, String(formData.get("password") ?? ""), String(formData.get("confirmPassword") ?? ""));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors };
    console.error("[reset-password]", e);
    return { error: "We couldn't reset your password. Please try again." };
  }
  return { redirectTo: "/login?reset=1" };
}
