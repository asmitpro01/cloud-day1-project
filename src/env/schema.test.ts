import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./schema";

const base = {
  NODE_ENV: "development",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000/",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/app",
  BETTER_AUTH_SECRET: "x".repeat(32),
  EMAIL_FROM: "Kit <hello@example.com>",
};

describe("parseServerEnv", () => {
  it("applies safe defaults", () => {
    const env = parseServerEnv(base);
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.otp).toEqual({ provider: "none" });
    expect(env.email.provider).toBe("console");
    expect(env.payments).toEqual({ provider: "none" });
    expect(env.google).toBeNull();
    expect(env.databaseUrlUnpooled).toBe(base.DATABASE_URL);
    expect(env.trustedIpHeader).toBe("x-forwarded-for");
  });

  it("treats blank values from .env.example as unset", () => {
    const env = parseServerEnv({ ...base, OTP_PROVIDER: "", GOOGLE_CLIENT_ID: " ", PAYMENTS_PROVIDER: "" });
    expect(env.otp.provider).toBe("none");
    expect(env.google).toBeNull();
  });

  it("requires provider keys for the chosen provider", () => {
    expect(() => parseServerEnv({ ...base, OTP_PROVIDER: "msg91" })).toThrow(/MSG91_AUTH_KEY/);
    expect(() => parseServerEnv({ ...base, PAYMENTS_PROVIDER: "razorpay" })).toThrow(/RAZORPAY_KEY_ID/);
    expect(() => parseServerEnv({ ...base, EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
  });

  it("rejects live Razorpay keys outside production", () => {
    const razorpay = {
      PAYMENTS_PROVIDER: "razorpay",
      RAZORPAY_KEY_ID: "rzp_live_abc",
      RAZORPAY_KEY_SECRET: "secret",
      RAZORPAY_WEBHOOK_SECRET: "whsec",
    };
    expect(() => parseServerEnv({ ...base, ...razorpay })).toThrow(/Live Razorpay keys/);
    const env = parseServerEnv({ ...base, ...razorpay, RAZORPAY_KEY_ID: "rzp_test_abc" });
    expect(env.payments).toMatchObject({ provider: "razorpay", mode: "test" });
  });

  it("rejects dev-only providers in production", () => {
    expect(() =>
      parseServerEnv({ ...base, NODE_ENV: "production", OTP_PROVIDER: "console", PAYMENTS_PROVIDER: "fake" }),
    ).toThrow(/OTP_PROVIDER=console[\s\S]*EMAIL_PROVIDER=console[\s\S]*PAYMENTS_PROVIDER=fake/);
  });

  it("validates basics", () => {
    expect(() => parseServerEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => parseServerEnv({ ...base, DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
    expect(() => parseServerEnv({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("parses admin emails", () => {
    const env = parseServerEnv({ ...base, ADMIN_EMAILS: " Founder@Example.com, ops@example.com ,," });
    expect([...env.adminEmails]).toEqual(["founder@example.com", "ops@example.com"]);
  });
});
