import "server-only";
import { serverEnv } from "@/env/server";
import { getOtpSender } from "../providers/otp";

export type AuthMethods = { phone: boolean; google: boolean };

/** Which sign-in methods this deployment has configured. */
export function getAuthMethods(): AuthMethods {
  return { phone: getOtpSender() !== null, google: serverEnv().google !== null };
}
