import "server-only";
import { logger } from "../logger";
import type { BillingFollowUp } from "./follow-ups";

/** Runs post-commit work such as emailing invoices. Failures are logged, never thrown. */
export async function runBillingFollowUps(followUps: BillingFollowUp[]): Promise<void> {
  for (const followUp of followUps) {
    try {
      switch (followUp.type) {
        case "send-invoice-email":
          // Wired up with GST invoices (Phase 4).
          break;
      }
    } catch (error) {
      logger.error("Billing follow-up failed", { error, followUp });
    }
  }
}
