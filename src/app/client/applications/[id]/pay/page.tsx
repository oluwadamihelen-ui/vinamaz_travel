import { notFound, redirect } from "next/navigation";
import { requireClientPage } from "@/lib/auth/session";
import { getApplicationPaymentId } from "@/lib/services/payments";
import { getOwnedApplication } from "@/lib/services/applications";
import { AppError } from "@/lib/errors";

/** /client/applications/[id]/pay forwards to the application's payment page. */
export default async function ApplicationPayRedirect({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClientPage();
  const { id } = await params;
  try {
    await getOwnedApplication(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const paymentId = await getApplicationPaymentId(actor, id);
  redirect(paymentId ? `/client/payments/${paymentId}` : `/client/applications/${id}`);
}
