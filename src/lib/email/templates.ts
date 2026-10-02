const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#fcf9f5;font-family:Inter,Arial,sans-serif;color:#2b0b0e">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #eadfd2;border-radius:16px">
<tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;letter-spacing:.12em;color:#b01012">VINAMAZ <span style="color:#d99a1c">TRAVELS</span></td></tr>
<tr><td style="padding:8px 32px 32px"><h1 style="font-size:22px;margin:16px 0 12px">${esc(title)}</h1>${bodyHtml}</td></tr>
</table>
<p style="font-size:12px;color:#665557;margin:16px 0 0">Vinamaz Travels provides visa assistance. We are not a government agency and cannot guarantee visa approval.</p>
</td></tr></table></body></html>`;
}

export function passwordResetEmail(opts: { name: string; link: string; minutes: number }) {
  const first = opts.name.split(" ")[0] ?? "there";
  const html = layout(
    "Reset your password",
    `<p style="font-size:15px;line-height:1.6">Hi ${esc(first)}, we received a request to reset the password for your Vinamaz account.</p>
<p style="margin:24px 0"><a href="${esc(opts.link)}" style="background:#b01012;color:#fff;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">Choose a new password</a></p>
<p style="font-size:13px;line-height:1.6;color:#665557">This link works once and expires in ${opts.minutes} minutes. If you didn't ask for this, you can ignore this email and your password will stay the same.</p>
<p style="font-size:12px;line-height:1.6;color:#665557;word-break:break-all">If the button doesn't work, copy this link into your browser:<br>${esc(opts.link)}</p>`,
  );
  const text = `Hi ${first},\n\nWe received a request to reset your Vinamaz password. Choose a new password here (works once, expires in ${opts.minutes} minutes):\n\n${opts.link}\n\nIf you didn't ask for this, ignore this email.\n\nVinamaz Travels`;
  return { subject: "Reset your Vinamaz password", html, text };
}

export function staffInviteEmail(opts: { name: string; link: string; hours: number }) {
  const first = opts.name.split(" ")[0] ?? "there";
  const html = layout(
    "You've been invited to Vinamaz Travels",
    `<p style="font-size:15px;line-height:1.6">Hi ${esc(first)}, an account has been created for you on the Vinamaz staff portal. Choose a password to get started.</p>
<p style="margin:24px 0"><a href="${esc(opts.link)}" style="background:#b01012;color:#fff;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">Set your password</a></p>
<p style="font-size:13px;line-height:1.6;color:#665557">This link works once and expires in ${opts.hours} hours. If it has expired, use "Forgot password?" on the sign-in page.</p>`,
  );
  const text = `Hi ${first},\n\nAn account has been created for you on the Vinamaz staff portal. Set your password here (works once, expires in ${opts.hours} hours):\n\n${opts.link}\n\nVinamaz Travels`;
  return { subject: "You've been invited to Vinamaz Travels", html, text };
}

export function paymentSuccessEmail(opts: { name: string; reference: string; amount: string; applicationNumber: string; packageName: string; link: string }) {
  const first = opts.name.split(" ")[0] ?? "there";
  const html = layout(
    "Payment received",
    `<p style="font-size:15px;line-height:1.6">Hi ${esc(first)}, we've received your payment. Thank you.</p>
<table style="font-size:14px;line-height:1.8;margin:12px 0"><tr><td style="color:#665557;padding-right:16px">Amount</td><td><strong>${esc(opts.amount)}</strong></td></tr>
<tr><td style="color:#665557;padding-right:16px">Reference</td><td>${esc(opts.reference)}</td></tr>
<tr><td style="color:#665557;padding-right:16px">Application</td><td>${esc(opts.applicationNumber)} · ${esc(opts.packageName)}</td></tr></table>
<p style="margin:24px 0"><a href="${esc(opts.link)}" style="background:#b01012;color:#fff;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">View receipt</a></p>`,
  );
  const text = `Hi ${first},\n\nWe've received your payment of ${opts.amount} (reference ${opts.reference}) for application ${opts.applicationNumber} (${opts.packageName}).\n\nView your receipt: ${opts.link}\n\nVinamaz Travels`;
  return { subject: `Payment received · ${opts.reference}`, html, text };
}

// ---------------------------------------------------------------------------
// Phase 5: application, payment and message emails. One shared builder keeps the look consistent.
// ---------------------------------------------------------------------------

interface NoticeOptions {
  name: string;
  subject: string;
  heading: string;
  /** Plain paragraphs (escaped). */
  paragraphs: string[];
  /** Optional key/value rows. */
  details?: [string, string][];
  cta?: { label: string; link: string };
  footnote?: string;
}

function notice(o: NoticeOptions) {
  const first = o.name.split(" ")[0] || "there";
  const rows = o.details?.length
    ? `<table style="font-size:14px;line-height:1.8;margin:12px 0">${o.details.map(([k, v]) => `<tr><td style="color:#665557;padding-right:16px;vertical-align:top">${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join("")}</table>`
    : "";
  const html = layout(
    o.heading,
    `<p style="font-size:15px;line-height:1.6">Hi ${esc(first)},</p>${o.paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6">${esc(p)}</p>`).join("")}${rows}${
      o.cta ? `<p style="margin:24px 0"><a href="${esc(o.cta.link)}" style="background:#b01012;color:#fff;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block">${esc(o.cta.label)}</a></p>` : ""
    }${o.footnote ? `<p style="font-size:13px;line-height:1.6;color:#665557">${esc(o.footnote)}</p>` : ""}`,
  );
  const text = [`Hi ${first},`, "", ...o.paragraphs, ...(o.details ?? []).map(([k, v]) => `${k}: ${v}`), ...(o.cta ? ["", `${o.cta.label}: ${o.cta.link}`] : []), ...(o.footnote ? ["", o.footnote] : []), "", "Vinamaz Travels"].join("\n");
  return { subject: o.subject, html, text };
}

export const welcomeEmail = (o: { name: string; link: string }) =>
  notice({
    name: o.name, subject: "Welcome to Vinamaz Travels", heading: "Welcome to Vinamaz Travels",
    paragraphs: ["Your account is ready. You can browse our visa assistance packages, start an application and follow every step from your dashboard.", "We provide application support and guidance. We are not a government agency, and the decision on any visa always rests with the relevant authority."],
    cta: { label: "Go to my dashboard", link: o.link },
  });

export const applicationSubmittedEmail = (o: { name: string; applicationNumber: string; packageName: string; link: string; paymentDue: boolean }) =>
  notice({
    name: o.name, subject: `Application received · ${o.applicationNumber}`, heading: "We've received your application",
    paragraphs: o.paymentDue ? ["Thank you for submitting your application. The next step is to complete payment so our team can begin reviewing it."] : ["Thank you for submitting your application. Our team will review it and be in touch if anything else is needed."],
    details: [["Application", o.applicationNumber], ["Package", o.packageName]],
    cta: { label: o.paymentDue ? "Continue to payment" : "View my application", link: o.link },
  });

export const paymentFailedEmail = (o: { name: string; reference: string; amount: string; applicationNumber: string; reason: string | null; link: string }) =>
  notice({
    name: o.name, subject: `Payment unsuccessful · ${o.reference}`, heading: "Your payment didn't go through",
    paragraphs: ["We weren't able to confirm this payment. You have not been charged for anything we haven't confirmed, and you can try again at any time.", ...(o.reason ? [`Reason given: ${o.reason}`] : [])],
    details: [["Amount", o.amount], ["Reference", o.reference], ["Application", o.applicationNumber]],
    cta: { label: "Try again", link: o.link },
  });

export const documentReplacementEmail = (o: { name: string; applicationNumber: string; documentName: string; reason: string | null; replacement: boolean; link: string }) =>
  notice({
    name: o.name, subject: `Action needed: ${o.documentName} · ${o.applicationNumber}`, heading: "We need a new document",
    paragraphs: [`Our team reviewed your ${o.documentName} and ${o.replacement ? "need you to upload a replacement" : "couldn't accept it as submitted"}.`, ...(o.reason ? [`Note from our team: ${o.reason}`] : []), "Please upload a clear, complete copy so we can continue with your application."],
    details: [["Application", o.applicationNumber], ["Document", o.documentName]],
    cta: { label: "Upload document", link: o.link },
  });

export const additionalInfoEmail = (o: { name: string; applicationNumber: string; note: string | null; link: string }) =>
  notice({
    name: o.name, subject: `More information needed · ${o.applicationNumber}`, heading: "We need a little more information",
    paragraphs: ["To keep your application moving, our team needs some additional information from you.", ...(o.note ? [`Note from our team: ${o.note}`] : [])],
    details: [["Application", o.applicationNumber]],
    cta: { label: "View my application", link: o.link },
  });

export const statusChangedEmail = (o: { name: string; applicationNumber: string; statusLabel: string; note: string | null; link: string }) =>
  notice({
    name: o.name, subject: `Application update · ${o.applicationNumber}`, heading: "Your application has been updated",
    paragraphs: [`The status of your application is now "${o.statusLabel}".`, ...(o.note ? [`Note from our team: ${o.note}`] : [])],
    details: [["Application", o.applicationNumber], ["Status", o.statusLabel]],
    cta: { label: "View my application", link: o.link },
  });

export const applicationCompletedEmail = (o: { name: string; applicationNumber: string; packageName: string; link: string }) =>
  notice({
    name: o.name, subject: `Application completed · ${o.applicationNumber}`, heading: "Your application is complete",
    paragraphs: ["We've completed our work on your application. Thank you for trusting Vinamaz Travels with it. Your messages, documents and receipts stay available in your dashboard."],
    details: [["Application", o.applicationNumber], ["Package", o.packageName]],
    cta: { label: "View my application", link: o.link },
  });

export const newMessageEmail = (o: { name: string; applicationNumber: string; senderLabel: string; preview: string; link: string; staff: boolean }) =>
  notice({
    name: o.name, subject: `New message about ${o.applicationNumber}`, heading: "You have a new message",
    paragraphs: [`${o.senderLabel} sent a message about application ${o.applicationNumber}.`, ...(o.preview ? [`"${o.preview}"`] : [])],
    cta: { label: "Read and reply", link: o.link },
    footnote: "For your security, messages and documents are only shown after you sign in.",
  });
