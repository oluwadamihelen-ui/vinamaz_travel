import { ShieldCheck } from "lucide-react";
import { Logo } from "@/components/site/logo";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <aside className="route-bg hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <Logo dark />
        <div>
          <h2 className="max-w-md text-4xl font-semibold leading-tight">Every step of your application, in one secure place.</h2>
          <ul className="mt-8 space-y-4 text-white/75">
            {["Save progress and continue any time", "Private document uploads", "Clear status updates and next actions"].map((t) => (
              <li key={t} className="flex items-center gap-3"><ShieldCheck className="size-5 text-gold-bright" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/50">Vinamaz provides visa assistance. We are not a government agency and cannot guarantee visa approval.</p>
      </aside>
      <main className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="mt-2 text-ink-3">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
