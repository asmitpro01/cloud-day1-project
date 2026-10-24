import "server-only";
import { serverEnv } from "@/env/server";
import { createConsoleOtpSender } from "./console";
import { createMsg91Sender } from "./msg91";
import { createTwilioSender } from "./twilio";
import type { OtpSender } from "./types";

let sender: OtpSender | null | undefined;

/** The configured OTP sender, or `null` when phone login is disabled (`OTP_PROVIDER=none`). */
export function getOtpSender(): OtpSender | null {
  if (sender === undefined) {
    const config = serverEnv().otp;
    switch (config.provider) {
      case "msg91":
        sender = createMsg91Sender(config);
        break;
      case "twilio":
        sender = createTwilioSender(config);
        break;
      case "console":
        sender = createConsoleOtpSender();
        break;
      case "none":
        sender = null;
        break;
    }
  }
  return sender;
}

export { OtpDeliveryError } from "./errors";
export type { OtpSender } from "./types";
