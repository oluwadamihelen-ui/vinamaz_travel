import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { LineItem } from "./amounts";

/** Standard PDF fonts only cover WinAnsi: replace anything else so a name never breaks a receipt. */
const safe = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, "?");
const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ReceiptData {
  reference: string;
  status: string;
  method: string;
  paidAt: Date;
  currency: string;
  amountMinor: number;
  refundedAmountMinor: number;
  items: LineItem[];
  clientName: string;
  clientEmail: string;
  applicationNumber: string;
  packageName: string;
}

const METHOD: Record<string, string> = { PAYSTACK: "Paystack", FLUTTERWAVE: "Flutterwave", KORAPAY: "Korapay", BANK_TRANSFER: "Bank transfer" };

export async function buildReceiptPdf(r: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.17, 0.04, 0.05);
  const muted = rgb(0.4, 0.33, 0.34);
  const brand = rgb(0.69, 0.06, 0.07);
  let y = 780;
  const text = (t: string, x: number, size = 11, f = font, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });

  try {
    const logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public", "brand", "logo-sm.png")));
    const h = 44;
    page.drawImage(logo, { x: 50, y: y - 20, width: (logo.width / logo.height) * h, height: h });
  } catch {
    text("VINAMAZ TRAVELS", 50, 18, bold, brand);
  }
  y -= 70;
  text("PAYMENT RECEIPT", 50, 22, bold);
  y -= 22;
  text(r.status === "SUCCESS" ? "Paid" : r.status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), 50, 12, bold, brand);
  y -= 34;

  const row = (label: string, value: string) => {
    text(label, 50, 10, font, muted);
    text(value, 190, 11, bold);
    y -= 22;
  };
  row("Receipt reference", r.reference);
  row("Date paid", r.paidAt.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC");
  row("Payment method", METHOD[r.method] ?? r.method);
  row("Billed to", `${r.clientName} (${r.clientEmail})`);
  row("Application", `${r.applicationNumber} - ${r.packageName}`);
  y -= 14;

  page.drawRectangle({ x: 50, y: y - 6, width: 495, height: 24, color: rgb(0.96, 0.93, 0.9) });
  text("Description", 60, 10, bold);
  page.drawText("Amount", { x: 480, y, size: 10, font: bold, color: ink });
  y -= 28;
  for (const it of r.items) {
    text(it.label, 60, 11);
    const t = money(it.amountMinor, r.currency);
    page.drawText(safe(t), { x: 545 - font.widthOfTextAtSize(safe(t), 11), y, size: 11, font, color: ink });
    y -= 22;
  }
  page.drawLine({ start: { x: 50, y: y + 10 }, end: { x: 545, y: y + 10 }, thickness: 0.8, color: rgb(0.9, 0.86, 0.8) });
  y -= 10;
  const total = money(r.amountMinor, r.currency);
  text("Total paid", 60, 12, bold);
  page.drawText(safe(total), { x: 545 - bold.widthOfTextAtSize(safe(total), 13), y, size: 13, font: bold, color: ink });
  if (r.refundedAmountMinor > 0) {
    y -= 22;
    text("Refunded", 60, 11, font, muted);
    const rf = `- ${money(r.refundedAmountMinor, r.currency)}`;
    page.drawText(safe(rf), { x: 545 - font.widthOfTextAtSize(safe(rf), 11), y, size: 11, font, color: muted });
  }
  y -= 70;
  for (const line of [
    "Vinamaz Travels provides visa assistance and application support services.",
    "Vinamaz Travels is not a government agency and does not guarantee visa approval.",
    "This receipt was generated electronically and is valid without a signature.",
  ]) {
    text(line, 50, 9, font, muted);
    y -= 14;
  }
  return pdf.save();
}
