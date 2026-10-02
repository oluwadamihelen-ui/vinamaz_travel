import type { Metadata } from "next";
import { BankAccountForm, MethodToggle } from "@/components/admin/settings-forms";
import { Badge, Card } from "@/components/ui/misc";
import { requireStaffPage } from "@/lib/auth/session";
import { getPaymentSettings } from "@/lib/services/payment-settings";

export const metadata: Metadata = { title: "Settings · Admin" };
export const dynamic = "force-dynamic";

const ENV: Record<string, string> = {
  PAYSTACK: "PAYSTACK_SECRET_KEY",
  FLUTTERWAVE: "FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_SECRET_HASH",
  KORAPAY: "KORAPAY_SECRET_KEY",
};

export default async function SettingsPage() {
  const actor = await requireStaffPage("settings.manage");
  const s = await getPaymentSettings(actor);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://your-domain").replace(/\/$/, "");
  return (
    <div className="space-y-8">
      <div><h1 className="text-3xl font-semibold">Settings</h1><p className="mt-1 text-ink-3">Payment methods and the bank accounts clients transfer to.</p></div>

      <Card className="p-6">
        <h2 className="text-xl font-semibold">Online payment gateways</h2>
        <p className="mt-1 text-sm text-ink-3">A gateway is offered to clients only when its keys are set in Vercel (Environment Variables) <em>and</em> it is switched on here. Keys are never shown.</p>
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {s.gateways.map((g) => (
            <li key={g.method} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{g.label}</p>
                <p className="text-xs text-ink-3">Webhook URL: <span className="font-mono">{base}/api/webhooks/{g.method.toLowerCase()}</span></p>
                {!g.configured && <p className="mt-1 text-xs text-gold">Not configured: set {ENV[g.method]} in Vercel and redeploy.</p>}
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={g.configured && g.enabled ? "ok" : "neutral"}>{!g.configured ? "No keys" : g.enabled ? "Live" : "Switched off"}</Badge>
                <MethodToggle method={g.method} enabled={g.enabled} disabled={!g.configured} />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Bank transfer</h2><p className="mt-1 text-sm text-ink-3">Offered when at least one active account matches the payment currency.</p></div>
          <div className="flex items-center gap-3"><Badge tone={s.bankTransferEnabled ? "ok" : "neutral"}>{s.bankTransferEnabled ? "On" : "Switched off"}</Badge><MethodToggle method="BANK_TRANSFER" enabled={s.bankTransferEnabled} /></div>
        </div>
        <div className="mt-6 space-y-6">
          {s.banks.map((b) => (
            <div key={b.id} className="rounded-2xl border border-line p-4">
              <div className="mb-3 flex items-center gap-2"><p className="font-semibold">{b.bankName}</p>{!b.isActive && <Badge>Hidden</Badge>}</div>
              <BankAccountForm id={b.id} initial={{ bankName: b.bankName, accountName: b.accountName, accountNumber: b.accountNumber, currency: b.currency, instructions: b.instructions, isActive: b.isActive }} />
            </div>
          ))}
          <div className="rounded-2xl border border-dashed border-line p-4"><p className="mb-3 font-semibold">Add a bank account</p><BankAccountForm id={null} /></div>
        </div>
      </Card>
    </div>
  );
}
