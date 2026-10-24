import "server-only";
import { site } from "@/config/site";
import type { DbOrTx } from "../db/client";
import { userConsents } from "../db/schema";
import type { ConsentClaim } from "./consent-token";

export const CONSENT_PURPOSE = "terms_and_privacy";

/** Stores the consent a user gave at sign-up (DPDP Act s.6: free, specific, informed and recorded). */
export async function recordConsent(
  db: DbOrTx,
  input: { userId: string; claim: ConsentClaim; ipAddress: string | null; userAgent: string | null },
): Promise<void> {
  await db.insert(userConsents).values({
    userId: input.userId,
    purpose: CONSENT_PURPOSE,
    policyVersion: input.claim.policyVersion,
    grantedAt: input.claim.grantedAt,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
}

export function currentPolicyVersion(): string {
  return site.legal.privacyPolicyVersion;
}
