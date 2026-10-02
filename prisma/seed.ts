/**
 * Safe seed: creates the three initial destination packages as DRAFT, with no prices,
 * processing times, requirements, inclusions or claims. Administrators fill these in.
 * Optionally creates ONE super admin when SEED_SUPER_ADMIN_EMAIL / _PASSWORD are set.
 * Never seeds clients, payments, applications, testimonials or statistics.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const PACKAGES = [
  { slug: "china", name: "China", country: "China", displayOrder: 1 },
  { slug: "canada", name: "Canada", country: "Canada", displayOrder: 2 },
  { slug: "switzerland", name: "Switzerland", country: "Switzerland", displayOrder: 3 },
];

async function main() {
  for (const p of PACKAGES) {
    // `update: {}` keeps this idempotent and never overwrites edits made by administrators.
    await prisma.travelPackage.upsert({ where: { slug: p.slug }, update: {}, create: { ...p, status: "DRAFT" } });
  }
  console.log(`Seeded ${PACKAGES.length} draft packages.`);

  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error("SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters");
    const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Vinamaz Super Admin", passwordHash, role: "SUPER_ADMIN", emailVerifiedAt: new Date() },
    });
    console.log(`Super admin ensured: ${email}`);
  } else {
    console.log("No SEED_SUPER_ADMIN_* set: skipping admin creation.");
  }
}

main().finally(() => prisma.$disconnect());
