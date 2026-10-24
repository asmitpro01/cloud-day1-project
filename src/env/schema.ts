import { z } from "zod";

// `.env.example` ships keys with empty values; treat "" as "not set".
const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const required = (name: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: `${name} is required` })
      .trim()
      .min(1, `${name} is required`),
  );

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXT_PUBLIC_APP_URL: z.preprocess(blankToUndefined, z.url({ error: "NEXT_PUBLIC_APP_URL must be a URL" })),
  DATABASE_URL: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "DATABASE_URL is required" })
      .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must be a postgres:// URL"),
  ),
  DATABASE_URL_UNPOOLED: optional(z.string().regex(/^postgres(ql)?:\/\//)),

  BETTER_AUTH_SECRET: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "BETTER_AUTH_SECRET is required (openssl rand -base64 32)" })
      .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  ),
  GOOGLE_CLIENT_ID: optional(z.string()),
  GOOGLE_CLIENT_SECRET: optional(z.string()),
  ADMIN_EMAILS: optional(z.string()),
  TRUSTED_IP_HEADER: optional(z.string()),

  OTP_PROVIDER: z.preprocess(blankToUndefined, z.enum(["msg91", "twilio", "console", "none"]).default("none")),
  MSG91_AUTH_KEY: optional(z.string()),
  MSG91_TEMPLATE_ID: optional(z.string()),
  TWILIO_ACCOUNT_SID: optional(z.string()),
  TWILIO_AUTH_TOKEN: optional(z.string()),
  TWILIO_FROM: optional(z.string()),

  EMAIL_PROVIDER: z.preprocess(blankToUndefined, z.enum(["resend", "console"]).default("console")),
  RESEND_API_KEY: optional(z.string()),
  EMAIL_FROM: required("EMAIL_FROM"),
  EMAIL_REPLY_TO: optional(z.email()),

  PAYMENTS_PROVIDER: z.preprocess(blankToUndefined, z.enum(["razorpay", "fake", "none"]).default("none")),
  RAZORPAY_KEY_ID: optional(z.string()),
  RAZORPAY_KEY_SECRET: optional(z.string()),
  RAZORPAY_WEBHOOK_SECRET: optional(z.string()),
});

type RawEnv = z.infer<typeof rawSchema>;

export type OtpConfig =
  | { provider: "msg91"; authKey: string; templateId: string }
  | { provider: "twilio"; accountSid: string; authToken: string; from: string }
  | { provider: "console" }
  | { provider: "none" };

export type EmailConfig =
  | { provider: "resend"; apiKey: string; from: string; replyTo: string | undefined }
  | { provider: "console"; from: string; replyTo: string | undefined };

export type PaymentsConfig =
  | { provider: "razorpay"; keyId: string; keySecret: string; webhookSecret: string; mode: "test" | "live" }
  | { provider: "fake"; keyId: string; keySecret: string; webhookSecret: string; mode: "test" }
  | { provider: "none" };

export type ServerEnv = {
  nodeEnv: RawEnv["NODE_ENV"];
  isProduction: boolean;
  appUrl: string;
  databaseUrl: string;
  databaseUrlUnpooled: string;
  authSecret: string;
  google: { clientId: string; clientSecret: string } | null;
  adminEmails: ReadonlySet<string>;
  trustedIpHeader: string;
  otp: OtpConfig;
  email: EmailConfig;
  payments: PaymentsConfig;
};

// Fixed credentials for the offline `fake` payment provider (tests and local demos only).
export const FAKE_PAYMENTS_CREDENTIALS = {
  keyId: "rzp_test_fake",
  keySecret: "fake_key_secret_for_tests_only",
  webhookSecret: "fake_webhook_secret_for_tests_only",
} as const;

class EnvError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}\nSee .env.example for every variable.`);
    this.name = "EnvError";
  }
}

function buildOtp(raw: RawEnv, issues: string[]): OtpConfig {
  switch (raw.OTP_PROVIDER) {
    case "msg91":
      if (!raw.MSG91_AUTH_KEY || !raw.MSG91_TEMPLATE_ID) {
        issues.push("OTP_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID");
        return { provider: "none" };
      }
      return { provider: "msg91", authKey: raw.MSG91_AUTH_KEY, templateId: raw.MSG91_TEMPLATE_ID };
    case "twilio":
      if (!raw.TWILIO_ACCOUNT_SID || !raw.TWILIO_AUTH_TOKEN || !raw.TWILIO_FROM) {
        issues.push("OTP_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM");
        return { provider: "none" };
      }
      return {
        provider: "twilio",
        accountSid: raw.TWILIO_ACCOUNT_SID,
        authToken: raw.TWILIO_AUTH_TOKEN,
        from: raw.TWILIO_FROM,
      };
    case "console":
      return { provider: "console" };
    case "none":
      return { provider: "none" };
  }
}

function buildEmail(raw: RawEnv, issues: string[]): EmailConfig {
  if (raw.EMAIL_PROVIDER === "resend") {
    if (!raw.RESEND_API_KEY) {
      issues.push("EMAIL_PROVIDER=resend needs RESEND_API_KEY");
    }
    return { provider: "resend", apiKey: raw.RESEND_API_KEY ?? "", from: raw.EMAIL_FROM, replyTo: raw.EMAIL_REPLY_TO };
  }
  return { provider: "console", from: raw.EMAIL_FROM, replyTo: raw.EMAIL_REPLY_TO };
}

function buildPayments(raw: RawEnv, issues: string[]): PaymentsConfig {
  switch (raw.PAYMENTS_PROVIDER) {
    case "razorpay": {
      const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: keySecret, RAZORPAY_WEBHOOK_SECRET: webhookSecret } = raw;
      if (!keyId || !keySecret || !webhookSecret) {
        issues.push(
          "PAYMENTS_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET",
        );
        return { provider: "none" };
      }
      const mode = keyId.startsWith("rzp_live_") ? "live" : keyId.startsWith("rzp_test_") ? "test" : null;
      if (!mode) {
        issues.push("RAZORPAY_KEY_ID must start with rzp_test_ or rzp_live_");
        return { provider: "none" };
      }
      if (mode === "live" && raw.NODE_ENV !== "production") {
        issues.push(
          "Live Razorpay keys (rzp_live_) are only allowed when NODE_ENV=production. Use rzp_test_ keys in development.",
        );
      }
      return { provider: "razorpay", keyId, keySecret, webhookSecret, mode };
    }
    case "fake":
      return { provider: "fake", mode: "test", ...FAKE_PAYMENTS_CREDENTIALS };
    case "none":
      return { provider: "none" };
  }
}

/** Parses and cross-validates raw environment variables into a typed config object. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const raw = parsed.data;
  const issues: string[] = [];
  const isProduction = raw.NODE_ENV === "production";

  const otp = buildOtp(raw, issues);
  const email = buildEmail(raw, issues);
  const payments = buildPayments(raw, issues);

  if (isProduction) {
    if (otp.provider === "console") issues.push("OTP_PROVIDER=console is not allowed in production");
    if (email.provider === "console") issues.push("EMAIL_PROVIDER=console is not allowed in production");
    if (payments.provider === "fake") issues.push("PAYMENTS_PROVIDER=fake is not allowed in production");
  }

  const hasGoogleId = Boolean(raw.GOOGLE_CLIENT_ID);
  if (hasGoogleId !== Boolean(raw.GOOGLE_CLIENT_SECRET)) {
    issues.push("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither");
  }

  if (issues.length > 0) throw new EnvError(issues);

  return {
    nodeEnv: raw.NODE_ENV,
    isProduction,
    appUrl: raw.NEXT_PUBLIC_APP_URL.replace(/\/+$/, ""),
    databaseUrl: raw.DATABASE_URL,
    databaseUrlUnpooled: raw.DATABASE_URL_UNPOOLED ?? raw.DATABASE_URL,
    authSecret: raw.BETTER_AUTH_SECRET,
    google:
      raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET
        ? { clientId: raw.GOOGLE_CLIENT_ID, clientSecret: raw.GOOGLE_CLIENT_SECRET }
        : null,
    adminEmails: new Set(
      (raw.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
    trustedIpHeader: (raw.TRUSTED_IP_HEADER ?? "x-forwarded-for").toLowerCase(),
    otp,
    email,
    payments,
  };
}
