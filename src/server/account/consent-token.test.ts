import { describe, expect, it } from "vitest";
import { createConsentToken, readCookie, verifyConsentToken } from "./consent-token";

const secret = "s".repeat(32);
const grantedAt = new Date("2026-10-24T10:00:00Z");

describe("consent token", () => {
  it("round-trips a valid claim", () => {
    const token = createConsentToken({ policyVersion: "2026-10-01", grantedAt }, secret);
    expect(verifyConsentToken(token, secret, new Date("2026-10-24T10:05:00Z"))).toEqual({
      policyVersion: "2026-10-01",
      grantedAt,
    });
  });

  it("rejects tampering, wrong secrets and stale tokens", () => {
    const token = createConsentToken({ policyVersion: "2026-10-01", grantedAt }, secret);
    const now = new Date("2026-10-24T10:05:00Z");
    expect(verifyConsentToken(token.replace("2026-10-01", "2099-01-01"), secret, now)).toBeNull();
    expect(verifyConsentToken(token, "t".repeat(32), now)).toBeNull();
    expect(verifyConsentToken(token, secret, new Date("2026-10-24T11:00:00Z"))).toBeNull();
    expect(verifyConsentToken("garbage", secret, now)).toBeNull();
  });

  it("reads cookies from a header", () => {
    expect(readCookie("a=1; kit=x%3Dy; b=2", "kit")).toBe("x=y");
    expect(readCookie("a=1", "kit")).toBeNull();
    expect(readCookie(null, "kit")).toBeNull();
  });
});
