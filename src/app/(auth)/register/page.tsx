import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/forms";
import { getActor } from "@/lib/auth/session";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "");
  const actor = await getActor();
  if (actor) redirect(next || (actor.role === "CLIENT" ? "/client/dashboard" : "/admin"));
  return (
    <AuthShell title="Create your account" subtitle="One account for your applications, documents and payments.">
      <RegisterForm next={next || undefined} />
    </AuthShell>
  );
}
