import "server-only";
import { Resend } from "resend";
import { AppError } from "@/lib/errors";
import type { EmailMessage, EmailSender } from "./types";

export class EmailDeliveryError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("EMAIL_DELIVERY_FAILED", message, options);
  }
}

export function createResendSender(config: { apiKey: string; from: string; replyTo: string | undefined }): EmailSender {
  const client = new Resend(config.apiKey);
  return {
    name: "resend",
    async send(message: EmailMessage) {
      const replyTo = message.replyTo ?? config.replyTo;
      const { data, error } = await client.emails.send({
        from: config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { replyTo } : {}),
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
        })),
        tags: message.tags ? Object.entries(message.tags).map(([name, value]) => ({ name, value })) : undefined,
      });
      if (error || !data) {
        throw new EmailDeliveryError(`Resend rejected the email: ${error?.message ?? "no response"}`);
      }
      return { id: data.id };
    },
  };
}
