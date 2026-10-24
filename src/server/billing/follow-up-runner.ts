import "server-only";
import { sendInvoiceEmail } from "../invoices/email";
import { logger } from "../logger";
import type { BillingFollowUp } from "./follow-ups";

/** Runs post-commit work such as emailing invoices. Failures are logged, never thrown. */
export async function runBillingFollowUps(followUps: BillingFollowUp[]): Promise<void> {
  for (const followUp of followUps) {
    try {
      switch (followUp.type) {
        case "send-invoice-email":
          await sendInvoiceEmail(followUp.invoiceId);
          break;
      }
    } catch (error) {
      logger.error("Billing follow-up failed", { error, followUp });
    }
  }
}
