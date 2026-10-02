import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requirePermission, type Actor } from "@/lib/auth/actor";
import { keyify } from "@/lib/slug";
import { faqSchema, packageInputSchema, type PackageInput } from "@/lib/validation/package";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Public (unauthenticated) reads — ACTIVE packages only. Drafts never leak.
// ---------------------------------------------------------------------------

const cardSelect = {
  id: true,
  slug: true,
  name: true,
  country: true,
  category: true,
  shortDescription: true,
  imageUrl: true,
  imageAlt: true,
  price: true,
  currency: true,
  processingEstimate: true,
  inclusions: true,
  isFeatured: true,
} satisfies Prisma.TravelPackageSelect;

export type PackageCard = Prisma.TravelPackageGetPayload<{ select: typeof cardSelect }>;

export function listPublicPackages(opts: { featuredOnly?: boolean; take?: number } = {}): Promise<PackageCard[]> {
  return db.travelPackage.findMany({
    where: { status: "ACTIVE", ...(opts.featuredOnly ? { isFeatured: true } : {}) },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: cardSelect,
    take: opts.take ?? 100,
  });
}

export async function getPublicPackageBySlug(slug: string) {
  const pkg = await db.travelPackage.findFirst({
    where: { slug, status: "ACTIVE" },
    include: {
      requirements: { orderBy: { sortOrder: "asc" } },
      documentRequirements: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!pkg) return null;
  return { ...pkg, faqs: faqSchema.catch([]).parse(pkg.faqs) };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function listAdminPackages(actor: Actor) {
  requirePermission(actor, "packages.view");
  return db.travelPackage.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, slug: true, name: true, country: true, category: true, status: true, isFeatured: true,
      displayOrder: true, price: true, currency: true, imageUrl: true, updatedAt: true,
    },
  });
}

export async function getAdminPackage(actor: Actor, id: string) {
  requirePermission(actor, "packages.view");
  const pkg = await db.travelPackage.findUnique({
    where: { id },
    include: {
      requirements: { orderBy: { sortOrder: "asc" } },
      documentRequirements: { orderBy: { sortOrder: "asc" } },
      questions: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!pkg) throw new AppError("Package not found.", "NOT_FOUND");
  return { ...pkg, faqs: faqSchema.catch([]).parse(pkg.faqs) };
}

function parseInput(raw: unknown): PackageInput {
  const parsed = packageInputSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "form"] ??= []).push(issue.message);
    throw new AppError("Please fix the highlighted fields.", "VALIDATION", fieldErrors);
  }
  return parsed.data;
}

const money = (v: number | undefined) => (v === undefined ? null : new Prisma.Decimal(v));

function scalarData(v: PackageInput) {
  return {
    slug: v.slug,
    name: v.name,
    country: v.country,
    category: v.category ?? null,
    shortDescription: v.shortDescription ?? null,
    description: v.description ?? null,
    imageAlt: v.imageAlt ?? null,
    price: money(v.price),
    applicationFee: money(v.applicationFee),
    serviceFee: money(v.serviceFee),
    currency: v.currency,
    processingEstimate: v.processingEstimate ?? null,
    inclusions: v.inclusions,
    exclusions: v.exclusions,
    importantInfo: v.importantInfo ?? null,
    terms: v.terms ?? null,
    faqs: v.faqs,
    status: v.status,
    isFeatured: v.isFeatured,
    displayOrder: v.displayOrder,
  };
}

/**
 * Sync child rows that are addressed by a stable `key` (document requirements,
 * questions): update in place, create new, delete removed. Keeping row ids stable
 * matters once applications reference questions (Phase 2).
 */
async function syncChildren(tx: Prisma.TransactionClient, packageId: string, v: PackageInput) {
  // Requirements have no inbound references: replace wholesale.
  await tx.packageRequirement.deleteMany({ where: { packageId } });
  if (v.requirements.length) {
    await tx.packageRequirement.createMany({
      data: v.requirements.map((r, i) => ({ packageId, type: r.type, title: r.title, description: r.description ?? null, sortOrder: i })),
    });
  }

  const docs = v.documentRequirements.map((d, i) => ({ ...d, key: d.key || keyify(d.name), sortOrder: i }));
  await tx.packageDocumentRequirement.deleteMany({ where: { packageId, key: { notIn: docs.map((d) => d.key) } } });
  for (const d of docs) {
    const data = {
      name: d.name, description: d.description ?? null, isRequired: d.isRequired,
      acceptedFormats: d.acceptedFormats, maxSizeMb: d.maxSizeMb, sortOrder: d.sortOrder,
    };
    await tx.packageDocumentRequirement.upsert({
      where: { packageId_key: { packageId, key: d.key } },
      create: { packageId, key: d.key, ...data },
      update: data,
    });
  }

  const questions = v.questions.map((q, i) => ({ ...q, key: q.key || keyify(q.label), sortOrder: i }));
  await tx.packageQuestion.deleteMany({ where: { packageId, key: { notIn: questions.map((q) => q.key) } } });
  for (const q of questions) {
    const data = {
      label: q.label, helpText: q.helpText ?? null, type: q.type, isRequired: q.isRequired,
      section: q.section ?? null, sortOrder: q.sortOrder,
      condition: q.condition ?? Prisma.DbNull,
    };
    const row = await tx.packageQuestion.upsert({
      where: { packageId_key: { packageId, key: q.key } },
      create: { packageId, key: q.key, ...data },
      update: data,
      select: { id: true },
    });
    await tx.packageQuestionOption.deleteMany({ where: { questionId: row.id } });
    const seen = new Set<string>();
    const options = q.options
      .map((o, i) => ({ questionId: row.id, label: o.label, value: o.value || keyify(o.label), sortOrder: i }))
      .filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)));
    if (options.length) await tx.packageQuestionOption.createMany({ data: options });
  }
}

function translateConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError("That slug is already used by another package.", "CONFLICT", { slug: ["That slug is already in use"] });
  }
  throw e;
}

export async function createPackage(actor: Actor, raw: unknown, imageUrl?: string | null) {
  requirePermission(actor, "packages.manage");
  const v = parseInput(raw);
  try {
    const created = await db.$transaction(async (tx) => {
      const pkg = await tx.travelPackage.create({ data: { ...scalarData(v), imageUrl: imageUrl ?? null }, select: { id: true, slug: true } });
      await syncChildren(tx, pkg.id, v);
      return pkg;
    });
    await recordAudit({ actorId: actor.id, action: "package.created", entityType: "TravelPackage", entityId: created.id, metadata: { slug: created.slug, status: v.status } });
    return created;
  } catch (e) {
    return translateConflict(e);
  }
}

/** `imageUrl`: undefined = keep existing, null = remove, string = replace. */
export async function updatePackage(actor: Actor, id: string, raw: unknown, imageUrl?: string | null) {
  requirePermission(actor, "packages.manage");
  const v = parseInput(raw);
  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.travelPackage.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new AppError("Package not found.", "NOT_FOUND");
      const pkg = await tx.travelPackage.update({
        where: { id },
        data: { ...scalarData(v), ...(imageUrl !== undefined ? { imageUrl } : {}) },
        select: { id: true, slug: true },
      });
      await syncChildren(tx, id, v);
      return { pkg, previousStatus: existing.status };
    });
    await recordAudit({
      actorId: actor.id, action: result.previousStatus !== v.status ? "package.status_changed" : "package.updated",
      entityType: "TravelPackage", entityId: id,
      metadata: { slug: result.pkg.slug, from: result.previousStatus, to: v.status },
    });
    return result.pkg;
  } catch (e) {
    return translateConflict(e);
  }
}

export async function setPackageStatus(actor: Actor, id: string, status: "ACTIVE" | "INACTIVE" | "DRAFT") {
  requirePermission(actor, "packages.manage");
  const existing = await db.travelPackage.findUnique({ where: { id }, select: { status: true, shortDescription: true, description: true } });
  if (!existing) throw new AppError("Package not found.", "NOT_FOUND");
  if (status === "ACTIVE" && !existing.shortDescription && !existing.description) {
    throw new AppError("Add a description before activating this package.", "VALIDATION");
  }
  await db.travelPackage.update({ where: { id }, data: { status } });
  await recordAudit({ actorId: actor.id, action: "package.status_changed", entityType: "TravelPackage", entityId: id, metadata: { from: existing.status, to: status } });
}
