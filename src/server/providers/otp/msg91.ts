import "server-only";
import { z } from "zod";
import { OtpDeliveryError } from "./errors";
import type { OtpSender } from "./types";

const responseSchema = z.object({
  type: z.string(),
  message: z.string().optional(),
  request_id: z.string().optional(),
});

/**
 * MSG91 OTP API in "send this code" mode: we pass our own OTP, so Better Auth keeps
 * control of expiry and attempts. The template must be DLT-approved and contain `##OTP##`.
 * Docs: https://docs.msg91.com/otp/sendotp
 */
export function createMsg91Sender(config: { authKey: string; templateId: string }): OtpSender {
  return {
    name: "msg91",
    async send({ to, code, expiresInMinutes }) {
      const url = new URL("https://control.msg91.com/api/v5/otp");
      url.searchParams.set("template_id", config.templateId);
      url.searchParams.set("mobile", to.replace(/^\+/, ""));
      url.searchParams.set("otp", code);
      url.searchParams.set("otp_expiry", String(expiresInMinutes));

      const response = await fetch(url, {
        method: "POST",
        headers: { authkey: config.authKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });
      const body = responseSchema.safeParse(await response.json().catch(() => null));
      if (!response.ok || !body.success || body.data.type !== "success") {
        const reason = body.success ? (body.data.message ?? body.data.type) : `HTTP ${response.status}`;
        throw new OtpDeliveryError(`MSG91 could not send the OTP: ${reason}`);
      }
    },
  };
}
