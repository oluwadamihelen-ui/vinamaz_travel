import { z } from "zod";
import { keyify, slugify } from "@/lib/slug";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optionalMoney = z.preprocess(
  blankToUndefined,
  z.coerce
    .number({ error: "Enter a valid amount" })
    .min(0, "Amount cannot be negative")
    .max(999_999_999.99)
    .optional(),
);

const stringList = z.array(z.string().trim().min(1).max(300)).max(40).default([]);

export const QUESTION_TYPES = [
  "TEXT", "TEXTAREA", "DATE", "NUMBER", "SELECT", "MULTI_SELECT", "RADIO", "CHECKBOX", "COUNTRY", "PHONE", "EMAIL", "FILE",
] as const;
export const OPTION_TYPES = ["SELECT", "MULTI_SELECT", "RADIO"] as const;

export const conditionSchema = z
  .object({
    questionKey: z.string().trim().min(1),
    operator: z.enum(["equals", "notEquals", "in"]),
    value: z.union([z.string(), z.array(z.string())]),
  })
  .nullable()
  .optional();

export const faqSchema = z.array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(2000) })).max(30).default([]);

const requirementSchema = z.object({
  type: z.enum(["ELIGIBILITY", "REQUIREMENT"]),
  title: z.string().trim().min(1, "Requirement title is required").max(300),
  description: optionalText(1500),
});

const documentRequirementSchema = z.object({
  key: z.string().trim().optional(),
  name: z.string().trim().min(1, "Document name is required").max(200),
  description: optionalText(1000),
  isRequired: z.boolean().default(true),
  acceptedFormats: z.array(z.enum(["pdf", "jpg", "png"])).min(1, "Select at least one format").default(["pdf", "jpg", "png"]),
  maxSizeMb: z.coerce.number().int().min(1).max(25).default(10),
});

const questionSchema = z
  .object({
    key: z.string().trim().optional(),
    label: z.string().trim().min(1, "Question text is required").max(300),
    helpText: optionalText(500),
    type: z.enum(QUESTION_TYPES),
    isRequired: z.boolean().default(false),
    section: optionalText(120),
    condition: conditionSchema,
    options: z.array(z.object({ label: z.string().trim().min(1).max(200), value: z.string().trim().optional() })).max(60).default([]),
  })
  .refine((q) => !(OPTION_TYPES as readonly string[]).includes(q.type) || q.options.length >= 1, {
    message: "Choice questions need at least one option",
    path: ["options"],
  });

export const packageInputSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a package name").max(160),
    country: z.string().trim().min(2, "Enter the destination country").max(80),
    slug: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()),
    category: optionalText(80),
    shortDescription: optionalText(300),
    description: optionalText(8000),
    imageAlt: optionalText(200),
    price: optionalMoney,
    applicationFee: optionalMoney,
    serviceFee: optionalMoney,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. NGN"),
    processingEstimate: optionalText(160),
    inclusions: stringList,
    exclusions: stringList,
    importantInfo: optionalText(4000),
    terms: optionalText(10000),
    faqs: faqSchema,
    status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]),
    isFeatured: z.boolean().default(false),
    displayOrder: z.coerce.number().int().min(0).max(100000).default(0),
    requirements: z.array(requirementSchema).max(60).default([]),
    documentRequirements: z.array(documentRequirementSchema).max(40).default([]),
    questions: z.array(questionSchema).max(120).default([]),
  })
  .transform((v) => {
    const slug = slugify(v.slug ?? v.name);
    return { ...v, slug };
  })
  .superRefine((v, ctx) => {
    if (!v.slug) ctx.addIssue({ code: "custom", path: ["slug"], message: "Slug must contain letters or numbers" });
    if (v.status === "ACTIVE" && !v.shortDescription && !v.description) {
      ctx.addIssue({ code: "custom", path: ["shortDescription"], message: "Add a description before activating this package" });
    }
    // Conditions must reference another question in the same package.
    const keys = new Set(v.questions.map((q) => q.key || keyify(q.label)));
    v.questions.forEach((q, i) => {
      if (q.condition && !keys.has(q.condition.questionKey)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "condition"], message: "Condition refers to an unknown question" });
      }
    });
    const dup = (arr: string[]) => arr.length !== new Set(arr).size;
    if (dup(v.questions.map((q) => q.key || keyify(q.label)))) {
      ctx.addIssue({ code: "custom", path: ["questions"], message: "Two questions have the same key; reword one of them" });
    }
    if (dup(v.documentRequirements.map((d) => d.key || keyify(d.name)))) {
      ctx.addIssue({ code: "custom", path: ["documentRequirements"], message: "Two documents have the same key; rename one" });
    }
  });

export type PackageInput = z.output<typeof packageInputSchema>;
