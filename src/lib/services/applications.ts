import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireClient, type Actor } from "@/lib/auth/actor";
import {
  buildSteps, computeProgress, documentSlots, questionsForStep, validateAnswers, visibleQuestions,
  type Answers, type Condition, type DocReqDef, type QuestionDef, type StepDef,
} from "@/lib/applications/engine";
import { CLIENT_EDITABLE_STATUSES, canTransition } from "@/lib/applications/status";
import { applicantDraftSchema, applicantSchema } from "@/lib/validation/application";
import { recordAudit } from "./audit";
import { nextApplicationNumber } from "./application-number";

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Package configuration -> engine definitions
// ---------------------------------------------------------------------------

export async function loadPackageConfig(packageId: string, client: Tx | typeof db = db) {
  const pkg = await client.travelPackage.findUnique({
    where: { id: packageId },
    select: {
      status: true, name: true, country: true,
      questions: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
      documentRequirements: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!pkg) throw new AppError("This package is no longer available.", "NOT_FOUND");
  const questions: QuestionDef[] = pkg.questions.map((q) => ({
    key: q.key, label: q.label, helpText: q.helpText, type: q.type, isRequired: q.isRequired, section: q.section,
    condition: (q.condition as Condition | null) ?? null,
    options: q.options.map((o) => ({ value: o.value, label: o.label })),
  }));
  const docReqs: DocReqDef[] = pkg.documentRequirements.map((d) => ({
    key: d.key, name: d.name, description: d.description, isRequired: d.isRequired, acceptedFormats: d.acceptedFormats, maxSizeMb: d.maxSizeMb,
  }));
  return { status: pkg.status, name: pkg.name, country: pkg.country, questions, docReqs };
}

type Config = Awaited<ReturnType<typeof loadPackageConfig>>;

function answersToMap(rows: { questionKey: string; value: Prisma.JsonValue }[]): Answers {
  const out: Answers = {};
  for (const r of rows) out[r.questionKey] = r.value as Answers[string];
  return out;
}

// ---------------------------------------------------------------------------
// Ownership-scoped loading. EVERY client read/write goes through this.
// ---------------------------------------------------------------------------

/**
 * Load an application only if it belongs to the acting client. A missing id and somebody
 * else's id are indistinguishable to the caller (both NOT_FOUND) so ids can't be probed.
 */
export async function getOwnedApplication(actor: Actor, applicationId: string, client: Tx | typeof db = db) {
  requireClient(actor);
  const app = await client.visaApplication.findFirst({ where: { id: applicationId, clientId: actor.id } });
  if (!app) throw new AppError("We couldn't find that application.", "NOT_FOUND");
  return app;
}

// ---------------------------------------------------------------------------
// Start / resume
// ---------------------------------------------------------------------------

export async function startApplication(actor: Actor, packageSlug: string): Promise<{ id: string; resumed: boolean }> {
  requireClient(actor);
  const pkg = await db.travelPackage.findFirst({ where: { slug: packageSlug, status: "ACTIVE" }, select: { id: true, name: true, country: true } });
  if (!pkg) throw new AppError("This package is not currently accepting applications.", "NOT_FOUND");

  const existing = await db.visaApplication.findFirst({ where: { clientId: actor.id, packageId: pkg.id, status: "DRAFT" }, select: { id: true } });
  if (existing) return { id: existing.id, resumed: true };

  const user = await db.user.findUnique({ where: { id: actor.id }, include: { clientProfile: true } });
  if (!user) throw new AppError("Please sign in to continue.", "UNAUTHENTICATED");
  const p = user.clientProfile;
  const applicant = {
    fullName: user.name,
    dateOfBirth: p?.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : undefined,
    nationality: p?.nationality ?? undefined,
    countryOfResidence: p?.countryOfResidence ?? undefined,
    phone: user.phone ?? undefined,
    whatsapp: p?.whatsapp ?? undefined,
  };

  try {
    const created = await db.$transaction(async (tx) => {
      const applicationNumber = await nextApplicationNumber(tx);
      const app = await tx.visaApplication.create({
        data: {
          applicationNumber, clientId: actor.id, packageId: pkg.id, packageName: pkg.name, packageCountry: pkg.country,
          applicant, currentStep: "details",
          statusHistory: { create: { fromStatus: null, toStatus: "DRAFT", changedById: actor.id, note: "Application started" } },
        },
        select: { id: true, applicationNumber: true },
      });
      return app;
    });
    await recordAudit({ actorId: actor.id, action: "application.created", entityType: "VisaApplication", entityId: created.id, metadata: { applicationNumber: created.applicationNumber, package: packageSlug } });
    return { id: created.id, resumed: false };
  } catch (e) {
    // Lost a race with a concurrent start: the one-draft-per-package index rejected us. Resume theirs.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await db.visaApplication.findFirst({ where: { clientId: actor.id, packageId: pkg.id, status: "DRAFT" }, select: { id: true } });
      if (winner) return { id: winner.id, resumed: true };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getApplicationView(actor: Actor, applicationId: string) {
  const app = await getOwnedApplication(actor, applicationId);
  const [config, answerRows, documents] = await Promise.all([
    loadPackageConfig(app.packageId),
    db.applicationAnswer.findMany({ where: { applicationId: app.id } }),
    db.applicationDocument.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const answers = answersToMap(answerRows);
  const slots = documentSlots(config.docReqs, config.questions, answers);
  const steps = buildSteps(config.questions, slots.length > 0);
  const currentDocs = documents.filter((d) => d.isCurrent);
  const progress = computeProgress({
    applicant: app.applicant as Record<string, unknown>, questions: config.questions, answers, slots,
    uploadedSlotKeys: new Set(currentDocs.map((d) => d.requirementKey)),
  });
  return { app, config, answers, steps, slots, documents, currentDocs, progress };
}

export async function listClientApplications(actor: Actor, opts: { take?: number; skip?: number } = {}) {
  requireClient(actor);
  const take = Math.min(opts.take ?? 20, 50);
  const [items, total] = await Promise.all([
    db.visaApplication.findMany({
      where: { clientId: actor.id },
      orderBy: { updatedAt: "desc" },
      take, skip: opts.skip ?? 0,
      select: { id: true, applicationNumber: true, packageName: true, packageCountry: true, status: true, progressPercent: true, currentStep: true, updatedAt: true, submittedAt: true },
    }),
    db.visaApplication.count({ where: { clientId: actor.id } }),
  ]);
  return { items, total };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export async function recomputeProgress(tx: Tx | typeof db, applicationId: string, config?: Config) {
  const app = await tx.visaApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { packageId: true, applicant: true } });
  const cfg = config ?? (await loadPackageConfig(app.packageId, tx));
  const [answerRows, docs] = await Promise.all([
    tx.applicationAnswer.findMany({ where: { applicationId } }),
    tx.applicationDocument.findMany({ where: { applicationId, isCurrent: true }, select: { requirementKey: true } }),
  ]);
  const answers = answersToMap(answerRows);
  const { percent } = computeProgress({
    applicant: app.applicant as Record<string, unknown>, questions: cfg.questions, answers,
    slots: documentSlots(cfg.docReqs, cfg.questions, answers), uploadedSlotKeys: new Set(docs.map((d) => d.requirementKey)),
  });
  await tx.visaApplication.update({ where: { id: applicationId }, data: { progressPercent: percent } });
  return percent;
}

function assertEditable(status: ApplicationStatus) {
  if (!CLIENT_EDITABLE_STATUSES.includes(status)) {
    throw new AppError("This application has been submitted and can no longer be edited here.", "FORBIDDEN");
  }
}

export interface SaveStepResult {
  ok: boolean;
  errors: Record<string, string>;
  nextStep: string | null;
}

/**
 * Save one wizard step. Well-formed values are always saved (so progress is never lost);
 * with `advance`, required fields are also enforced and the client only moves on when the
 * step is complete.
 */
export async function saveApplicationStep(
  actor: Actor,
  applicationId: string,
  stepKey: string,
  input: Record<string, unknown>,
  opts: { advance: boolean },
): Promise<SaveStepResult> {
  const app = await getOwnedApplication(actor, applicationId);
  assertEditable(app.status);
  const config = await loadPackageConfig(app.packageId);
  const answerRows = await db.applicationAnswer.findMany({ where: { applicationId: app.id } });
  const existing = answersToMap(answerRows);
  const slots = documentSlots(config.docReqs, config.questions, existing);
  const steps = buildSteps(config.questions, slots.length > 0);
  const step = steps.find((s) => s.key === stepKey);
  if (!step) throw new AppError("That step does not exist.", "VALIDATION");

  const errors: Record<string, string> = {};

  if (step.kind === "details") {
    const current = (app.applicant ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    for (const field of Object.keys(applicantDraftSchema.shape) as (keyof typeof applicantDraftSchema.shape)[]) {
      const r = applicantDraftSchema.shape[field].safeParse(input[field]);
      if (!r.success) errors[field] = r.error.issues[0]?.message ?? "Invalid value";
      else next[field] = r.data ?? null;
    }
    await db.visaApplication.update({ where: { id: app.id }, data: { applicant: next as Prisma.InputJsonObject } });
    if (opts.advance) {
      const full = applicantSchema.safeParse(next);
      if (!full.success) for (const i of full.error.issues) errors[String(i.path[0])] ??= i.message;
    }
  } else if (step.kind === "questions") {
    const stepQs = questionsForStep(step, config.questions);
    const partial = validateAnswers(stepQs, input, { partial: true, context: existing, allQuestions: config.questions });
    Object.assign(errors, partial.errors);
    const visibleKeys = new Set(visibleQuestions(config.questions, { ...existing, ...partial.values }).map((q) => q.key));
    await db.$transaction(async (tx) => {
      for (const q of stepQs) {
        const v = partial.values[q.key];
        if (v !== undefined && !partial.errors[q.key]) {
          await tx.applicationAnswer.upsert({
            where: { applicationId_questionKey: { applicationId: app.id, questionKey: q.key } },
            create: { applicationId: app.id, questionKey: q.key, label: q.label, value: v as Prisma.InputJsonValue },
            update: { label: q.label, value: v as Prisma.InputJsonValue },
          });
        } else if (!partial.errors[q.key] && (v === undefined || !visibleKeys.has(q.key))) {
          // Cleared by the client, or hidden by a condition: remove any stale answer.
          await tx.applicationAnswer.deleteMany({ where: { applicationId: app.id, questionKey: q.key } });
        }
      }
    });
    if (opts.advance) {
      const merged = answersToMap(await db.applicationAnswer.findMany({ where: { applicationId: app.id } }));
      const full = validateAnswers(stepQs, input, { partial: false, context: merged, allQuestions: config.questions });
      Object.assign(errors, full.errors);
    }
  } else if (step.kind === "documents" && opts.advance) {
    const docs = await db.applicationDocument.findMany({ where: { applicationId: app.id, isCurrent: true }, select: { requirementKey: true } });
    const have = new Set(docs.map((d) => d.requirementKey));
    for (const s of slots) if (s.isRequired && !have.has(s.key)) errors[s.key] = "Please upload this document";
  }

  const idx = steps.findIndex((s) => s.key === step.key);
  const hasErrors = Object.keys(errors).length > 0;
  const nextStep = opts.advance && !hasErrors ? (steps[idx + 1]?.key ?? step.key) : null;

  await recomputeProgress(db, app.id, config);
  await db.visaApplication.update({
    where: { id: app.id },
    data: { lastSavedAt: new Date(), currentStep: nextStep ?? (opts.advance ? app.currentStep : step.key) },
  });
  return { ok: !hasErrors, errors, nextStep };
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export async function submitApplication(actor: Actor, applicationId: string): Promise<{ applicationNumber: string }> {
  const app = await getOwnedApplication(actor, applicationId);
  if (app.status !== "DRAFT") throw new AppError("This application has already been submitted.", "CONFLICT");
  const config = await loadPackageConfig(app.packageId);
  if (config.status !== "ACTIVE") throw new AppError("This package is no longer accepting applications.", "VALIDATION");

  const [answerRows, docs] = await Promise.all([
    db.applicationAnswer.findMany({ where: { applicationId: app.id } }),
    db.applicationDocument.findMany({ where: { applicationId: app.id, isCurrent: true }, select: { requirementKey: true } }),
  ]);
  const answers = answersToMap(answerRows);
  const problems: Record<string, string> = {};

  const applicant = applicantSchema.safeParse(app.applicant);
  if (!applicant.success) for (const i of applicant.error.issues) problems[`applicant.${String(i.path[0])}`] = i.message;

  const raw = Object.fromEntries(Object.entries(answers));
  const { errors } = validateAnswers(config.questions, raw, { partial: false, context: answers });
  Object.assign(problems, errors);

  const have = new Set(docs.map((d) => d.requirementKey));
  for (const s of documentSlots(config.docReqs, config.questions, answers)) {
    if (s.isRequired && !have.has(s.key)) problems[`document.${s.key}`] = `${s.name} has not been uploaded`;
  }
  if (Object.keys(problems).length) {
    throw new AppError("Your application could not be submitted. Please check the required fields.", "VALIDATION", Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, [v]])));
  }

  const to: ApplicationStatus = "APPLICATION_SUBMITTED";
  if (!canTransition(app.status, to)) throw new AppError("This application cannot be submitted.", "CONFLICT");

  await db.$transaction(async (tx) => {
    // Compare-and-set on status: two concurrent submits cannot both succeed.
    const res = await tx.visaApplication.updateMany({
      where: { id: app.id, clientId: actor.id, status: "DRAFT" },
      data: { status: to, submittedAt: new Date(), progressPercent: 100, currentStep: "review" },
    });
    if (res.count !== 1) throw new AppError("This application has already been submitted.", "CONFLICT");
    await tx.applicationStatusHistory.create({ data: { applicationId: app.id, fromStatus: "DRAFT", toStatus: to, changedById: actor.id, note: "Application submitted by client" } });
  });
  await recordAudit({ actorId: actor.id, action: "application.submitted", entityType: "VisaApplication", entityId: app.id, metadata: { applicationNumber: app.applicationNumber } });
  return { applicationNumber: app.applicationNumber };
}

export type WizardView = Awaited<ReturnType<typeof getApplicationView>>;
export type { StepDef };
