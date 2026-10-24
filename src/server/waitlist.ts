import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { site } from "@/config/site";
import { WaitlistConfirmationEmail } from "@/emails/waitlist-confirmation";
import { getDb } from "./db/client";
import { waitlistEntries } from "./db/schema";
import { sendEmail } from "./email";
import { logger } from "./logger";
import { enforceRateLimit, RATE_LIMITS } from "./rate-limit";

export const waitlistInputSchema = z.object({
  name: z.string().trim().min(1, "Please tell us your name").max(100, "That name is a bit long"),
  email: z.email("Please enter a valid email").trim().max(254),
  source: z.string().trim().max(100).optional(),
});

export type WaitlistInput = z.infer<typeof waitlistInputSchema>;

/**
 * Adds an email to the waitlist and sends a confirmation once. Joining twice is a no-op,
 * and both cases look the same to the caller so the form can't be used to probe emails.
 */
export async function joinWaitlist(input: WaitlistInput, context: { ip: string }): Promise<void> {
  await enforceRateLimit(
    `waitlist:ip:${context.ip}`,
    RATE_LIMITS.waitlistPerIp,
    "Too many sign-ups from your network. Try again later.",
  );

  const db = getDb();
  const [entry] = await db
    .insert(waitlistEntries)
    .values({
      name: input.name,
      email: input.email,
      emailNormalized: input.email.toLowerCase(),
      source: input.source ?? null,
    })
    .onConflictDoNothing({ target: waitlistEntries.emailNormalized })
    .returning({ id: waitlistEntries.id });

  if (!entry) return;

  try {
    await sendEmail({
      to: input.email,
      subject: `You're on the ${site.brand.name} waitlist`,
      template: WaitlistConfirmationEmail({ name: input.name }),
      tags: { type: "waitlist" },
    });
    await db.update(waitlistEntries).set({ confirmationSentAt: new Date() }).where(eq(waitlistEntries.id, entry.id));
  } catch (error) {
    // The signup is saved; a failed confirmation shouldn't fail the form.
    logger.error("Waitlist confirmation email failed", { error, entryId: entry.id });
  }
}
