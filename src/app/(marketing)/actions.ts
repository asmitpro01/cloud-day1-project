"use server";

import { headers } from "next/headers";
import { publicErrorMessage, RateLimitError } from "@/lib/errors";
import { fail, failValidation, ok, type ActionResult } from "@/lib/result";
import { logger } from "@/server/logger";
import { getClientIp } from "@/server/rate-limit";
import { joinWaitlist, waitlistInputSchema } from "@/server/waitlist";

const SUCCESS = { message: "You're on the list! Check your inbox for a confirmation." };

export async function joinWaitlistAction(
  _previous: ActionResult<{ message: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ message: string }>> {
  // Bots fill the hidden field; pretend it worked so they don't adapt.
  if (formData.get("company")) return ok(SUCCESS);

  const parsed = waitlistInputSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    source: "landing",
  });
  if (!parsed.success) return failValidation(parsed.error);

  try {
    await joinWaitlist(parsed.data, { ip: getClientIp(await headers()) });
    return ok(SUCCESS);
  } catch (error) {
    if (error instanceof RateLimitError) return fail(error.code, error.message);
    logger.error("joinWaitlist failed", { error });
    return fail("INTERNAL", publicErrorMessage(error));
  }
}
