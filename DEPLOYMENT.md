# Deploying Vinamaz to Vercel

The app is Vercel-ready: `vercel-build` runs `prisma generate && prisma migrate deploy && next build`,
so each deploy applies pending database migrations before building.

## 1. Create the backing services
1. **Neon** project -> copy both connection strings:
   - pooled (host contains `-pooler`) -> `DATABASE_URL`
   - direct (no `-pooler`) -> `DIRECT_URL` (used only by `prisma migrate`)
2. **Vercel Blob** (Storage tab) - create **two** stores:
   - a **public** store (package marketing images) -> `BLOB_READ_WRITE_TOKEN`
   - a **private** store (applicant documents) -> `PRIVATE_BLOB_READ_WRITE_TOKEN`

   Applicant documents must only ever be in the private store. (Confirm store access types in the
   Vercel dashboard; the code uses `access: "private"` for documents and `"public"` for package images.)

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
| `BLOB_READ_WRITE_TOKEN` | public store token |
| `PRIVATE_BLOB_READ_WRITE_TOKEN` | private store token |
| `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM` | Phase 4/5 - not used yet |

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
