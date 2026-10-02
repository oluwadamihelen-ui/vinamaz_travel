import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";
import { getActor } from "@/lib/auth/session";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "");
  const actor = await getActor();
  if (actor) redirect(next || (actor.role === "CLIENT" ? "/client/dashboard" : "/admin"));
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue your application or check its progress.">
      <LoginForm next={next || undefined} />
    </AuthShell>
  );
}
