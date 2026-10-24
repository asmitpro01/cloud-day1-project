"use server";

import { cookies } from "next/headers";
import { site } from "@/config/site";
import { serverEnv } from "@/env/server";
import { ok, type ActionResult } from "@/lib/result";
import { CONSENT_COOKIE, CONSENT_COOKIE_MAX_AGE_SECONDS, createConsentToken } from "@/server/account/consent-token";

/**
 * Records that the visitor ticked the consent box, as a short-lived signed cookie.
 * Better Auth's user-creation hook refuses to create an account without it.
 */
export async function acceptConsentAction(): Promise<ActionResult<null>> {
  const env = serverEnv();
  const token = createConsentToken(
    { policyVersion: site.legal.privacyPolicyVersion, grantedAt: new Date() },
    env.authSecret,
  );
  (await cookies()).set(CONSENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    maxAge: CONSENT_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return ok(null);
}
