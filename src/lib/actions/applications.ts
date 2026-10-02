"use server";

import { redirect } from "next/navigation";
import { requireClient } from "@/lib/auth/actor";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { saveApplicationStep, startApplication, submitApplication } from "@/lib/services/applications";

export interface WizardState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function startApplicationAction(packageSlug: string) {
  let id: string;
  try {
    const actor = requireClient(await getActor());
    ({ id } = await startApplication(actor, packageSlug));
  } catch (e) {
    if (e instanceof AppError && e.code === "UNAUTHENTICATED") redirect(`/login?next=${encodeURIComponent(`/apply/${packageSlug}`)}`);
    if (e instanceof AppError) redirect(`/packages/${packageSlug}`);
    throw e;
  }
  redirect(`/client/applications/${id}/apply`);
}

/** Reads `q_<key>` / plain fields from the posted form into a raw input object. */
function readInput(formData: FormData): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const name of new Set(formData.keys())) {
    if (name === "intent" || name.startsWith("$ACTION")) continue;
    const all = formData.getAll(name).filter((v): v is string => typeof v === "string");
    input[name.startsWith("q_") ? name.slice(2) : name] = all.length > 1 ? all : all[0];
  }
  return input;
}

export async function saveStepAction(applicationId: string, stepKey: string, _prev: WizardState, formData: FormData): Promise<WizardState> {
  const intent = formData.get("intent") === "save" ? "save" : "next";
  let nextStep: string | null = null;
  try {
    const actor = requireClient(await getActor());
    const res = await saveApplicationStep(actor, applicationId, stepKey, readInput(formData), { advance: intent === "next" });
    if (!res.ok) return { error: "Please check the highlighted fields.", fieldErrors: res.errors };
    nextStep = res.nextStep;
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "UNAUTHENTICATED") redirect("/login");
      return { error: e.message };
    }
    console.error("[saveStep]", e);
    return { error: "We couldn't save your progress. Please try again." };
  }
  if (intent === "save") redirect("/client/dashboard?saved=1");
  redirect(`/client/applications/${applicationId}/apply?step=${nextStep}`);
}

export async function submitApplicationAction(applicationId: string, _prev: WizardState, formData: FormData): Promise<WizardState> {
  if (formData.get("confirm") !== "on") return { error: "Please confirm that the information you've provided is accurate." };
  try {
    const actor = requireClient(await getActor());
    await submitApplication(actor, applicationId);
  } catch (e) {
    if (e instanceof AppError) {
      const fieldErrors = e.fieldErrors ? Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0] ?? ""])) : undefined;
      return { error: e.message, fieldErrors };
    }
    console.error("[submit]", e);
    return { error: "Your application could not be submitted. Please try again." };
  }
  redirect(`/client/applications/${applicationId}?submitted=1`);
}
