import "server-only";
import { z } from "zod";
import { OtpDeliveryError } from "./errors";
import type { OtpSender } from "./types";

const errorSchema = z.object({ message: z.string().optional(), code: z.number().optional() });

/**
 * Twilio Programmable Messaging. Indian numbers still need a DLT-registered template on
 * Twilio's side. `from` is an E.164 number or a Messaging Service SID (MG…).
 */
export function createTwilioSender(config: { accountSid: string; authToken: string; from: string }): OtpSender {
  return {
    name: "twilio",
    async send({ to, code, expiresInMinutes }) {
      const body = new URLSearchParams({
        To: to,
        Body: `${code} is your verification code. It expires in ${expiresInMinutes} minutes. Do not share it with anyone.`,
      });
      body.set(config.from.startsWith("MG") ? "MessagingServiceSid" : "From", config.from);

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const error = errorSchema.safeParse(await response.json().catch(() => null));
        const reason = error.success && error.data.message ? error.data.message : `HTTP ${response.status}`;
        throw new OtpDeliveryError(`Twilio could not send the OTP: ${reason}`);
      }
    },
  };
}
