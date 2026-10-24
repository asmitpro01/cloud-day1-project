export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  /** Provider tags for analytics, e.g. { type: "invoice" }. */
  tags?: Record<string, string>;
};

/** Sends a fully rendered email. Implement this to swap Resend for SES, Postmark, etc. */
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string }>;
}
