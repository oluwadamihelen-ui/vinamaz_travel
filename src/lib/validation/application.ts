import { z } from "zod";
import { COUNTRIES } from "@/lib/countries";

const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number");

/** Core applicant details collected in the first wizard step. */
export const applicantSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the applicant's full name").max(120),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date of birth")
    .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v) < new Date() && new Date(v).getFullYear() > 1900, "Enter a valid date of birth"),
  nationality: z.string().trim().min(2, "Enter your nationality").max(80),
  countryOfResidence: z.string().trim().refine((v) => (COUNTRIES as readonly string[]).includes(v), "Select your country of residence"),
  phone,
  whatsapp: z.preprocess(blank, phone.optional()),
});

export type Applicant = z.infer<typeof applicantSchema>;

/** Draft-save variant: every field optional, but anything supplied must still be well-formed. */
export const applicantDraftSchema = z.object({
  fullName: z.preprocess(blank, applicantSchema.shape.fullName.optional()),
  dateOfBirth: z.preprocess(blank, applicantSchema.shape.dateOfBirth.optional()),
  nationality: z.preprocess(blank, applicantSchema.shape.nationality.optional()),
  countryOfResidence: z.preprocess(blank, applicantSchema.shape.countryOfResidence.optional()),
  phone: z.preprocess(blank, phone.optional()),
  whatsapp: z.preprocess(blank, phone.optional()),
});

function blank(v: unknown) {
  return v === null || (typeof v === "string" && v.trim() === "") ? undefined : v;
}
