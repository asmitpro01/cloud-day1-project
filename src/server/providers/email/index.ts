import "server-only";
import { serverEnv } from "@/env/server";
import { createConsoleEmailSender } from "./console";
import { createResendSender } from "./resend";
import type { EmailSender } from "./types";

let sender: EmailSender | undefined;

/** The configured email sender (Resend in production, console in development). */
export function getEmailSender(): EmailSender {
  if (!sender) {
    const config = serverEnv().email;
    sender = config.provider === "resend" ? createResendSender(config) : createConsoleEmailSender(config);
  }
  return sender;
}

export type { EmailAttachment, EmailMessage, EmailSender } from "./types";
