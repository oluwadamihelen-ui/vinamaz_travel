"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/actor";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createPackage, setPackageStatus, updatePackage } from "@/lib/services/packages";
import { storePackageImage } from "@/lib/storage/package-images";
import type { FormState } from "./auth";

function revalidate(slug?: string) {
  revalidatePath("/");
  revalidatePath("/packages");
  if (slug) revalidatePath(`/packages/${slug}`);
  revalidatePath("/admin/packages");
}

/** Shared by create and edit. `id` present = edit. */
export async function savePackageAction(id: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  let slug: string | undefined;
  try {
    let payload: unknown;
    try {
      payload = JSON.parse(String(formData.get("payload") ?? "{}"));
    } catch {
      throw new AppError("The form data was invalid. Please reload and try again.");
    }
    // Checked before any upload so we never store an image for an unauthorised caller
    // (the service re-checks as well).
    const actor = requirePermission(await getActor(), "packages.manage");

    let imageUrl: string | null | undefined;
    const file = formData.get("image");
    if (file instanceof File && file.size > 0) imageUrl = await storePackageImage(file);
    else if (formData.get("removeImage") === "on") imageUrl = null;

    const saved = id ? await updatePackage(actor, id, payload, imageUrl) : await createPackage(actor, payload, imageUrl);
    slug = saved.slug;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors };
    console.error("[savePackage]", e);
    return { error: "We couldn't save this package. Please try again." };
  }
  revalidate(slug);
  redirect("/admin/packages?saved=1");
}

export async function setPackageStatusAction(id: string, status: "ACTIVE" | "INACTIVE" | "DRAFT") {
  const actor = requirePermission(await getActor(), "packages.manage");
  await setPackageStatus(actor, id, status);
  revalidate();
}
