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
