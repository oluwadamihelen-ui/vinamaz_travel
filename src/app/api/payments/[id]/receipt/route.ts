import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { buildReceiptPdf } from "@/lib/payments/receipt-pdf";
import { getReceipt } from "@/lib/services/payments";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const r = await getReceipt(await getActor(), (await ctx.params).id);
    const pdf = await buildReceiptPdf({
      reference: r.payment.reference, status: r.payment.status, method: r.payment.method ?? "BANK_TRANSFER", paidAt: r.payment.paidAt!, currency: r.payment.currency,
      amountMinor: r.payment.amountMinor, refundedAmountMinor: r.payment.refundedAmountMinor, items: r.items,
      clientName: r.client.name, clientEmail: r.client.email, applicationNumber: r.application.applicationNumber, packageName: r.application.packageName,
    });
    return new Response(Buffer.from(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Vinamaz-receipt-${r.payment.reference}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 });
    console.error("[receipt]", e);
    return NextResponse.json({ error: "We couldn't create the receipt." }, { status: 500 });
  }
}
