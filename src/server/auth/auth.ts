import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { z } from "zod";
import { site } from "@/config/site";
import { ResetPasswordEmail } from "@/emails/reset-password";
import { VerifyEmail } from "@/emails/verify-email";
import { serverEnv } from "@/env/server";
import { formatPhone, isValidE164 } from "@/lib/phone";
import { recordConsent } from "../account/consent";
import { CONSENT_COOKIE, readCookie, verifyConsentToken } from "../account/consent-token";
import { getDb } from "../db/client";
import { account, session, user, verification } from "../db/schema";
import { sendEmail } from "../email";
import { logger } from "../logger";
import { getOtpSender } from "../providers/otp";
import { hitRateLimit, RATE_LIMITS, type RateLimitRule } from "../rate-limit";
import { placeholderEmailForPhone } from "./placeholder-email";

export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;

const phoneBody = z.object({ phoneNumber: z.string() });
const emailBody = z.object({ email: z.string() });

function headerValue(headers: Headers | undefined, name: string): string | null {
  return headers?.get(name) ?? null;
}

function clientIp(headers: Headers | undefined): string {
  const value = headerValue(headers, serverEnv().trustedIpHeader);
  return value?.split(",")[0]?.trim() || "unknown";
}

async function limit(key: string, rule: RateLimitRule, message: string): Promise<void> {
  const result = await hitRateLimit(key, rule);
  if (!result.allowed) {
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { message, code: "RATE_LIMITED" },
      { "Retry-After": String(result.retryAfterSeconds) },
    );
  }
}

/**
 * Rate limits for auth endpoints, stored in Postgres so they hold across serverless instances.
 * OTP sends are limited per phone AND per IP, with a 30-second resend cooldown.
 */
const rateLimitAuthRequests = createAuthMiddleware(async (ctx) => {
  const ip = clientIp(ctx.headers);
  switch (ctx.path) {
    case "/phone-number/send-otp": {
      if (!getOtpSender()) throw new APIError("NOT_FOUND", { message: "Phone login is not enabled" });
      const body = phoneBody.safeParse(ctx.body);
      if (!body.success || !isValidE164(body.data.phoneNumber)) {
        throw new APIError("BAD_REQUEST", { message: "Enter a valid mobile number", code: "INVALID_PHONE_NUMBER" });
      }
      const phone = body.data.phoneNumber;
      await limit(
        `otp:cooldown:${phone}`,
        RATE_LIMITS.otpResendCooldown,
        "Please wait 30 seconds before requesting another code.",
      );
      await limit(
        `otp:send:phone:${phone}`,
        RATE_LIMITS.otpSendPerPhone,
        "Too many codes sent to this number. Try again in an hour.",
      );
      await limit(
        `otp:send:ip:${ip}`,
        RATE_LIMITS.otpSendPerIp,
        "Too many codes requested from your network. Try again later.",
      );
      return;
    }
    case "/phone-number/verify": {
      const body = phoneBody.safeParse(ctx.body);
      const phone = body.success ? body.data.phoneNumber : "invalid";
      await limit(
        `otp:verify:phone:${phone}`,
        RATE_LIMITS.otpVerifyPerPhone,
        "Too many attempts. Request a new code later.",
      );
      await limit(
        `otp:verify:ip:${ip}`,
        RATE_LIMITS.otpVerifyPerIp,
        "Too many attempts from your network. Try again later.",
      );
      return;
    }
    case "/sign-in/email": {
      const body = emailBody.safeParse(ctx.body);
      await limit(`signin:ip:${ip}`, RATE_LIMITS.signInPerIp, "Too many sign-in attempts. Try again in a few minutes.");
      if (body.success) {
        await limit(
          `signin:email:${body.data.email.toLowerCase()}`,
          RATE_LIMITS.signInPerEmail,
          "Too many sign-in attempts for this account. Try again later.",
        );
      }
      return;
    }
    case "/sign-up/email":
      await limit(`signup:ip:${ip}`, RATE_LIMITS.signUpPerIp, "Too many sign-ups from your network. Try again later.");
      return;
    case "/request-password-reset":
    case "/send-verification-email":
    case "/change-email":
      await limit(`email-link:ip:${ip}`, RATE_LIMITS.emailLinksPerIp, "Too many emails requested. Try again later.");
      return;
  }
});

function createAuth() {
  const env = serverEnv();
  return betterAuth({
    appName: site.brand.name,
    baseURL: env.appUrl,
    secret: env.authSecret,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: target, url }) => {
        await sendEmail({
          to: target.email,
          subject: `Reset your ${site.brand.name} password`,
          template: ResetPasswordEmail({ name: target.name, url }),
          tags: { type: "reset-password" },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: target, url }) => {
        await sendEmail({
          to: target.email,
          subject: `Confirm your email for ${site.brand.name}`,
          template: VerifyEmail({ name: target.name, url }),
          tags: { type: "verify-email" },
        });
      },
    },
    socialProviders: env.google
      ? { google: { clientId: env.google.clientId, clientSecret: env.google.clientSecret, prompt: "select_account" } }
      : {},
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
      // Phone-only accounts start with a placeholder email and can set a real one directly.
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // Our Postgres-backed limiter (hooks below) replaces Better Auth's in-memory one.
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: [env.trustedIpHeader] },
      useSecureCookies: env.appUrl.startsWith("https://"),
    },
    databaseHooks: {
      user: {
        create: {
          // DPDP: no account without recorded consent, whichever sign-up method is used.
          before: async (_newUser, ctx) => {
            const token = readCookie(headerValue(ctx?.headers, "cookie"), CONSENT_COOKIE);
            const claim = token ? verifyConsentToken(token, env.authSecret) : null;
            if (!claim) {
              throw new APIError("FORBIDDEN", {
                message: "Please accept the Terms and Privacy Policy on the sign-up page to create an account.",
                code: "CONSENT_REQUIRED",
              });
            }
          },
          after: async (createdUser, ctx) => {
            const token = readCookie(headerValue(ctx?.headers, "cookie"), CONSENT_COOKIE);
            const claim = token ? verifyConsentToken(token, env.authSecret) : null;
            if (!claim) return;
            await recordConsent(getDb(), {
              userId: createdUser.id,
              claim,
              ipAddress: clientIp(ctx?.headers),
              userAgent: headerValue(ctx?.headers, "user-agent"),
            });
          },
        },
      },
    },
    hooks: { before: rateLimitAuthRequests },
    plugins: [
      phoneNumber({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: OTP_MAX_ATTEMPTS,
        phoneNumberValidator: (phone) => isValidE164(phone),
        sendOTP: async ({ phoneNumber: phone, code }) => {
          const sender = getOtpSender();
          if (!sender) throw new APIError("NOT_FOUND", { message: "Phone login is not enabled" });
          try {
            await sender.send({ to: phone, code, expiresInMinutes: OTP_EXPIRES_IN_SECONDS / 60 });
          } catch (error) {
            logger.error("OTP delivery failed", { error, provider: sender.name });
            throw new APIError("BAD_GATEWAY", {
              message: "We couldn't send the code. Please try again.",
              code: "OTP_DELIVERY_FAILED",
            });
          }
        },
        signUpOnVerification: {
          getTempEmail: placeholderEmailForPhone,
          getTempName: formatPhone,
        },
      }),
      // Must be last: lets server actions that call auth.api set cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** The Better Auth instance, created on first use so builds don't need runtime secrets. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
