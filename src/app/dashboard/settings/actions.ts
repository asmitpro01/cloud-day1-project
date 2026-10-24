"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { billingProfileSchema } from "@/lib/billing-profile";
import { publicErrorMessage } from "@/lib/errors";
import { fail, failValidation, ok, type ActionResult } from "@/lib/result";
import { saveBillingProfile } from "@/server/account/billing-profile";
import { deleteAccount } from "@/server/account/delete";
import { getAuth } from "@/server/auth/auth";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";

const profileSchema = z.object({ name: z.string().trim().min(2, "Enter your name").max(100) });

export async function updateProfileAction(
  _previous: ActionResult<{ message: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ message: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const parsed = profileSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return failValidation(parsed.error);

  await getAuth().api.updateUser({ body: { name: parsed.data.name }, headers: await headers() });
  return ok({ message: "Profile saved." });
}

export async function saveBillingProfileAction(
  _previous: ActionResult<{ message: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ message: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const parsed = billingProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failValidation(parsed.error);

  try {
    await saveBillingProfile(getDb(), user.id, parsed.data);
    return ok({ message: "Billing details saved. They'll appear on your next invoice." });
  } catch (error) {
    logger.error("saveBillingProfile failed", { error, userId: user.id });
    return fail("INTERNAL", publicErrorMessage(error));
  }
}

const deleteSchema = z.object({ confirm: z.literal("DELETE", { error: "Type DELETE to confirm" }) });

export async function deleteAccountAction(
  _previous: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const parsed = deleteSchema.safeParse({ confirm: formData.get("confirm") });
  if (!parsed.success) return failValidation(parsed.error);

  try {
    await deleteAccount(user.id);
  } catch (error) {
    logger.error("deleteAccount failed", { error, userId: user.id });
    return fail("INTERNAL", publicErrorMessage(error, "We couldn't delete your account. Please contact support."));
  }
  // Sessions were deleted with the user; clear the now-useless cookies too.
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.includes("better-auth")) cookieStore.delete(cookie.name);
  }
  redirect("/?account=deleted");
}
