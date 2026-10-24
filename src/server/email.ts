import "server-only";
import type { ReactElement } from "react";
import { render } from "react-email";
import { logger } from "./logger";
import { getEmailSender, type EmailAttachment } from "./providers/email";

// Phone-only accounts get a placeholder address on this reserved TLD (RFC 2606); never email it.
const UNDELIVERABLE_DOMAIN = /\.invalid$/i;

export function isDeliverableEmail(email: string): boolean {
  return !UNDELIVERABLE_DOMAIN.test(email);
}

export type SendEmailInput = {
  to: string;
  subject: string;
  template: ReactElement;
  attachments?: EmailAttachment[];
  tags?: Record<string, string>;
};

/**
 * Renders a React Email template to HTML and plain text and sends it.
 * Returns `null` when the recipient is a placeholder address.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string } | null> {
  if (!isDeliverableEmail(input.to)) {
    logger.info("Skipped email to placeholder address", { subject: input.subject });
    return null;
  }
  const [html, text] = await Promise.all([render(input.template), render(input.template, { plainText: true })]);
  const result = await getEmailSender().send({
    to: input.to,
    subject: input.subject,
    html,
    text,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
  });
  logger.info("Email sent", { subject: input.subject, id: result.id });
  return result;
}
