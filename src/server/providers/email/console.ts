import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EmailMessage, EmailSender } from "./types";

/** Directory where dev-only adapters drop messages. Playwright reads it in the smoke test. */
export const OUTBOX_DIR = path.join(process.cwd(), ".outbox");

/**
 * Development sender: prints a one-line summary and writes the full email (HTML, text,
 * attachments) to `.outbox/emails/`. Rejected in production by env validation.
 */
export function createConsoleEmailSender(config: { from: string }): EmailSender {
  return {
    name: "console",
    async send(message: EmailMessage) {
      const id = `dev_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const dir = path.join(OUTBOX_DIR, "emails", id);
      await mkdir(dir, { recursive: true });
      const attachments: string[] = [];
      for (const attachment of message.attachments ?? []) {
        const file = path.basename(attachment.filename);
        await writeFile(path.join(dir, file), attachment.content);
        attachments.push(file);
      }
      await writeFile(path.join(dir, "email.html"), message.html);
      await writeFile(
        path.join(dir, "email.json"),
        JSON.stringify(
          {
            id,
            from: config.from,
            to: message.to,
            subject: message.subject,
            text: message.text,
            attachments,
            tags: message.tags,
          },
          null,
          2,
        ),
      );
      console.log(`[email:console] to=${message.to} subject="${message.subject}" → .outbox/emails/${id}`);
      return { id };
    },
  };
}
