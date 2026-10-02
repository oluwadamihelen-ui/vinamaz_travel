# Deploying Vinamaz to Vercel

The app is Vercel-ready: `vercel-build` runs `prisma generate && prisma migrate deploy && next build`,
so each deploy applies pending database migrations before building.

## 1. Create the backing services
1. **Neon** project -> copy both connection strings:
   - pooled (host contains `-pooler`) -> `DATABASE_URL`
   - direct (no `-pooler`) -> `DIRECT_URL` (used only by `prisma migrate`)
2. **Vercel Blob** (Storage tab) - create **one private** store and connect it to the project. Vercel adds
   `BLOB_READ_WRITE_TOKEN` automatically. It holds applicant documents (served only through the authorised
   download route) and package artwork (served through `/api/package-images/...`, which can only read the
   `package-images/` folder). `PRIVATE_BLOB_READ_WRITE_TOKEN` is optional and, if set, takes precedence.

## 2. Import the repository
Vercel dashboard -> *Add New Project* -> import `oluwadamihelen-ui/vinamaz_travel`. Framework: Next.js (auto).
Production branch: set to the branch you want live (this work is on `claude/vinamaz-portal-audit-e2bfa7` until merged).

## 3. Environment variables (Production + Preview)
| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `DIRECT_URL` | Neon direct URL |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` |
| `BLOB_READ_WRITE_TOKEN` | the private Blob store token (added by Vercel when you connect the store) |
| `RESEND_API_KEY` | Resend API key - **required for password reset emails** |
| `EMAIL_FROM` | e.g. `Vinamaz Travels <no-reply@vinamaz.com>` - the domain must be verified in Resend |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (test key `sk_test_...` first, then live) |
| `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH` | Flutterwave secret key, and the webhook "secret hash" you choose in their dashboard |
| `KORAPAY_SECRET_KEY` | Korapay secret key |

`AUTH_TRUST_HOST` is not needed on Vercel. Do **not** set `ALLOW_LOCAL_PRIVATE_STORAGE` in production.

## 4. First admin and packages
After the first successful deploy, run the seed once from your machine against the production DB:

    DATABASE_URL="<neon url>" SEED_SUPER_ADMIN_EMAIL="you@vinamaz.com" SEED_SUPER_ADMIN_PASSWORD="<12+ chars>" npm run db:seed

On **Windows cmd** wrap the whole assignment in quotes, otherwise `&` in the URL (e.g. `&channel_binding=require`)
is treated as a command separator. Close the window afterwards:

    set "DATABASE_URL=<neon url>"
    set "SEED_SUPER_ADMIN_EMAIL=you@vinamaz.com"
    set "SEED_SUPER_ADMIN_PASSWORD=<12+ chars, avoid % ^ &>"
    npm run db:seed

On **PowerShell**: `$env:DATABASE_URL="<neon url>"` (same for the other two), then `npm run db:seed`.

This creates the China/Canada/Switzerland **draft** packages and one super admin. Sign in at `/login`,
open `/admin/packages`, fill in real package details and upload artwork, then activate each package.

## Known deployment limits
- Document uploads are proxied through a serverless function, so each file is capped at ~4MB
  (Vercel's request-body limit); phone photos are compressed client-side. Move to Blob client uploads if larger PDFs are needed.
- The rate limiter is in-memory per instance; add Upstash/Vercel KV before launch.

## Email (password reset)
Password reset sends an email through Resend. Without `RESEND_API_KEY` in production no email is sent
(the page still says "if an account exists..." by design, and the failure is logged as `[email] failed to send`).
1. Create a Resend account, add and verify your sending domain (DNS records), create an API key.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` in Vercel (Production) and redeploy.
   Until the domain is verified, Resend only delivers to your own account email using `onboarding@resend.dev`.
Reset links work once and expire after 60 minutes. Resetting a password also signs out all older sessions.

## Payments
Four methods are supported: **Paystack, Flutterwave, Korapay** (hosted checkout) and **manual bank transfer**.

1. Set the keys above in Vercel (Production) and redeploy. A gateway is offered to clients only when its keys are set
   **and** it is switched on in *Admin -> Settings*. Currencies offered per gateway: Paystack NGN/GHS/ZAR/KES/USD,
   Flutterwave NGN/USD/GBP/EUR/GHS/KES/ZAR/UGX/TZS/RWF/XOF/XAF, Korapay NGN/KES/GHS (your gateway account must also have
   the currency enabled).
2. In each gateway dashboard set the **webhook URL** (shown in *Admin -> Settings*):
   - Paystack: `https://<your-domain>/api/webhooks/paystack` (Settings -> API Keys & Webhooks)
   - Flutterwave: `https://<your-domain>/api/webhooks/flutterwave` with the same secret hash as `FLUTTERWAVE_SECRET_HASH`
   - Korapay: `https://<your-domain>/api/webhooks/korapay` (also sent per transaction)
3. *Admin -> Settings -> Bank transfer*: add Vinamaz's bank account (bank, account name, number, currency). Clients see it
   with the exact amount and their payment reference (to use as the transfer narration), upload their receipt, and staff
   with `payments.manage` confirm it in *Admin -> Payments*.
4. Test with each gateway's **test keys** first: pay with a test card, confirm the application moves to "Payment confirmed".

How payments are protected: the server computes every amount; a payment only becomes "Paid" after the gateway's verify API
confirms the amount, currency and reference (webhook signatures are checked first); webhooks and the return page share one
idempotent confirmation path; a mismatch is parked for staff review. Refunds are *recorded* in the app (payments.refund
permission, super admin by default) - send the money from the gateway dashboard or your bank.

> The gateway request/response shapes and webhook signature schemes were implemented from each provider's public API
> documentation and unit-tested against simulated responses. They have not been exercised against the live providers from
> this codebase, so run each gateway's sandbox end-to-end once before taking real money.
