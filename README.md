# Vinamaz — visa assistance portal

Next.js 16 (App Router) · TypeScript · Prisma 7 + PostgreSQL (Neon) · Auth.js · Tailwind 4 · Zod · Vitest · Playwright.

## Local setup
1. `npm install`
2. Copy `.env.example` to `.env`; set `DATABASE_URL`, `AUTH_SECRET` (`openssl rand -base64 32`).
3. `npx prisma migrate dev` then `npm run db:seed` (seeds China/Canada/Switzerland as **draft** packages only).
   To create a first super admin set `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` for the seed run.
4. `npm run dev`

## Scripts
`npm test` (needs a Postgres test DB; defaults to `vinamaz_test`, override with `TEST_DATABASE_URL`) ·
`npm run lint` · `npm run typecheck` · `npm run build` · `npm run test:e2e` (against `npm run start`).

## Rules
- Applicant documents are private (Vercel Blob private + authorised access, Phase 2). Never use `/public`.
- Package images are public marketing assets only.
- No fabricated prices, claims, testimonials or statistics. Unknown package data stays empty and is hidden.
