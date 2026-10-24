import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { OUTBOX_DIR } from "../email/console";
import type { OtpSender } from "./types";

/**
 * Development sender: prints the code in the terminal and writes it to `.outbox/sms/`,
 * where the Playwright smoke test reads it. Rejected in production by env validation.
 */
export function createConsoleOtpSender(): OtpSender {
  return {
    name: "console",
    async send({ to, code, expiresInMinutes }) {
      const dir = path.join(OUTBOX_DIR, "sms");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, `${to.replace(/\D/g, "")}.json`),
        JSON.stringify({ to, code, sentAt: new Date().toISOString() }),
      );
      console.log(`[otp:console] ${to} → ${code} (expires in ${expiresInMinutes} min)`);
    },
  };
}
