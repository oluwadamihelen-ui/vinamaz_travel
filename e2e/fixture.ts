import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/** Creates the packages the application-journey tests apply for. Idempotent. */
async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  async function ensure(slug: string, name: string, extra: Record<string, unknown> = {}) {
    const pkg = await prisma.travelPackage.upsert({
      where: { slug },
      update: { status: "ACTIVE", ...extra },
      create: { slug, name, country: "Testland", shortDescription: "Created by the end-to-end test suite.", status: "ACTIVE", ...extra },
    });
    if (await prisma.packageQuestion.count({ where: { packageId: pkg.id } })) return;
    const marital = await prisma.packageQuestion.create({ data: { packageId: pkg.id, key: "marital_status", label: "Marital status", type: "SELECT", isRequired: true, section: "Family", sortOrder: 0 } });
    await prisma.packageQuestionOption.createMany({ data: [{ questionId: marital.id, value: "single", label: "Single", sortOrder: 0 }, { questionId: marital.id, value: "married", label: "Married", sortOrder: 1 }] });
    await prisma.packageQuestion.create({ data: { packageId: pkg.id, key: "spouse_name", label: "Spouse name", type: "TEXT", isRequired: true, section: "Family", sortOrder: 1, condition: { questionKey: "marital_status", operator: "equals", value: "married" } } });
    await prisma.packageQuestion.create({ data: { packageId: pkg.id, key: "passport_number", label: "Passport number", type: "TEXT", isRequired: true, section: "Passport", sortOrder: 2 } });
    await prisma.packageDocumentRequirement.create({ data: { packageId: pkg.id, key: "international_passport", name: "International passport", isRequired: true, sortOrder: 0 } });
  }
  try {
    await ensure("e2e-journey", "E2E Journey Package");
    // A package with fees, so submitting leads to the payment step: NGN 150,000 + 5,000 service fee.
    await ensure("e2e-paid", "E2E Paid Package", { price: "150000", serviceFee: "5000", currency: "NGN" });
  } finally {
    await prisma.$disconnect();
  }
}

main();
