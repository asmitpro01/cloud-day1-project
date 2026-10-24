import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed proof that the visitor ticked the consent checkbox on the sign-up page.
 * Format: `<policyVersion>.<grantedAtMs>.<hmac>`. Kept in an httpOnly cookie for a few
 * minutes so every sign-up method (email, Google, phone OTP) can be checked server-side.
 */
export const CONSENT_COOKIE = "kit_signup_consent";
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 30 * 60;

export type ConsentClaim = { policyVersion: string; grantedAt: Date };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`consent:${payload}`).digest("base64url");
}

export function createConsentToken(claim: ConsentClaim, secret: string): string {
  const payload = `${claim.policyVersion}.${claim.grantedAt.getTime()}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the claim when the signature is valid and the token is fresh; otherwise `null`. */
export function verifyConsentToken(token: string, secret: string, now = new Date()): ConsentClaim | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(token.slice(lastDot + 1));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const separator = payload.lastIndexOf(".");
  const policyVersion = payload.slice(0, separator);
  const grantedAtMs = Number(payload.slice(separator + 1));
  if (!policyVersion || !Number.isSafeInteger(grantedAtMs)) return null;

  const ageMs = now.getTime() - grantedAtMs;
  if (ageMs < 0 || ageMs > CONSENT_COOKIE_MAX_AGE_SECONDS * 1000) return null;
  return { policyVersion, grantedAt: new Date(grantedAtMs) };
}

/** Reads one cookie from a raw `Cookie` header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}
