import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui/misc";
import { isResetTokenValid } from "@/lib/services/password-reset";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const valid = await isResetTokenValid(token);
  return (
    <AuthShell title="Choose a new password" subtitle="Pick a strong password you haven't used elsewhere.">
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-5">
          <Alert>This reset link is invalid or has expired.</Alert>
          <Link href="/forgot-password" className="inline-block font-semibold text-brand hover:underline">Request a new link</Link>
        </div>
      )}
    </AuthShell>
  );
}
