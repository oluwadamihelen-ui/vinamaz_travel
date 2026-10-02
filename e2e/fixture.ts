import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/** Creates the package the application-journey tests apply for. Idempotent. */
async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const pkg = await prisma.travelPackage.upsert({
      where: { slug: "e2e-journey" },
      update: { status: "ACTIVE" },
      create: { slug: "e2e-journey", name: "E2E Journey Package", country: "Testland", shortDescription: "Created by the end-to-end test suite.", status: "ACTIVE" },
    });
    const has = await prisma.packageQuestion.count({ where: { packageId: pkg.id } });
    if (!has) {
      const marital = await prisma.packageQuestion.create({ data: { packageId: pkg.id, key: "marital_status", label: "Marital status", type: "SELECT", isRequired: true, section: "Family", sortOrder: 0 } });
      await prisma.packageQuestionOption.createMany({ data: [{ questionId: marital.id, value: "single", label: "Single", sortOrder: 0 }, { questionId: marital.id, value: "married", label: "Married", sortOrder: 1 }] });
      await prisma.packageQuestion.create({ data: { packageId: pkg.id, key: "spouse_name", label: "Spouse name", type: "TEXT", isRequired: true, section: "Family", sortOrder: 1, condition: { questionKey: "marital_status", operator: "equals", value: "married" } } });
      await prisma.packageQuestion.create({ data: { packageId: pkg.id, key: "passport_number", label: "Passport number", type: "TEXT", isRequired: true, section: "Passport", sortOrder: 2 } });
      await prisma.packageDocumentRequirement.create({ data: { packageId: pkg.id, key: "international_passport", name: "International passport", isRequired: true, sortOrder: 0 } });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
