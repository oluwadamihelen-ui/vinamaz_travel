import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(254)
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[A-Za-z]/, "Include at least one letter")
  .regex(/[0-9]/, "Include at least one number");

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const registerSchema = z
  .object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  confirmPassword: z.string().min(1, "Confirm your password"),
  countryOfResidence: z.string().trim().min(2, "Select your country of residence").max(80),
  whatsapp: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(phoneSchema.optional()),
  nationality: optionalText(80),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
        .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v) < new Date(), "Enter a valid date of birth")
        .optional(),
    ),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(128),
});
