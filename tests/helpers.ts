import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import type { Role } from "@/generated/prisma/enums";

export async function resetDb() {
  await db.applicationDocument.deleteMany();
  await db.applicationStatusHistory.deleteMany();
  await db.applicationAnswer.deleteMany();
  await db.visaApplication.deleteMany();
  await db.auditLog.deleteMany();
  await db.travelPackage.deleteMany();
  await db.applicationCounter.deleteMany();
  await db.user.deleteMany();
}

export async function makeUser(role: Role, email: string, permissions: string[] = []): Promise<Actor> {
  const u = await db.user.create({
    data: {
      email, name: email.split("@")[0]!, passwordHash: "x", role, permissions,
      ...(role === "CLIENT" ? { clientProfile: { create: { countryOfResidence: "Nigeria" } } } : {}),
    },
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role, permissions: u.permissions };
}

export const validPackage = (over: Record<string, unknown> = {}) => ({
  name: "Canada Visa Assistance", country: "Canada", currency: "NGN", status: "DRAFT",
  shortDescription: "Professional application support.", ...over,
});

export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

/** An ACTIVE package with conditional questions and two document requirements. */
export async function makeActivePackage(admin: Actor, slugName = "Canada Visa Assistance") {
  const { createPackage } = await import("@/lib/services/packages");
  return createPackage(admin, validPackage({
    name: slugName, status: "ACTIVE",
    questions: [
      { label: "Marital status", type: "SELECT", isRequired: true, section: "Family", options: [{ label: "Single" }, { label: "Married" }] },
      { label: "Spouse name", type: "TEXT", isRequired: true, section: "Family", condition: { questionKey: "marital_status", operator: "equals", value: "married" } },
      { label: "Passport number", type: "TEXT", isRequired: true, section: "Passport" },
    ],
    documentRequirements: [{ name: "International passport", isRequired: true }, { name: "Bank statement", isRequired: false }],
  }));
}

/** Fill every required field so the application can be submitted. */
export async function completeApplication(client: Actor, id: string) {
  const { saveApplicationStep } = await import("@/lib/services/applications");
  const { uploadDocument } = await import("@/lib/services/documents");
  await saveApplicationStep(client, id, "details", { fullName: "Ada Obi", dateOfBirth: "1990-05-01", nationality: "Nigerian", countryOfResidence: "Nigeria", phone: "+2348030000000" }, { advance: true });
  await saveApplicationStep(client, id, "s-family", { marital_status: "single" }, { advance: true });
  await saveApplicationStep(client, id, "s-passport", { passport_number: "A1234567" }, { advance: true });
  await uploadDocument(client, { applicationId: id, requirementKey: "international_passport", filename: "passport.pdf", bytes: PDF });
}
