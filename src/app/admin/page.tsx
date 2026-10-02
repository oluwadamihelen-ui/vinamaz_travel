import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth/session";

/** Staff land on the dashboard, which shows only what they are allowed to see. */
export default async function AdminHome({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireStaffPage();
  const { denied } = await searchParams;
  redirect(denied ? "/admin/dashboard?denied=1" : "/admin/dashboard");
}
