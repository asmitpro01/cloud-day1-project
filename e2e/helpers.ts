import { createHmac } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { z } from "zod";

const OUTBOX = path.join(process.cwd(), ".outbox");

try {
  process.loadEnvFile(".env");
} catch {
  // CI passes DATABASE_URL directly.
}

/** Same constant as FAKE_PAYMENTS_CREDENTIALS in src/env/schema.ts. */
export const FAKE_WEBHOOK_SECRET = "fake_webhook_secret_for_tests_only";

export function randomIndianMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

async function poll<T>(read: () => Promise<T | null>, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Reads the OTP the console sender wrote for `+91<mobile>` after `since`. */
export async function readOtp(mobile: string, since: number): Promise<string> {
  const file = path.join(OUTBOX, "sms", `91${mobile}.json`);
  return poll(async () => {
    const info = await stat(file).catch(() => null);
    if (!info || info.mtimeMs < since) return null;
    return z.object({ code: z.string() }).parse(JSON.parse(await readFile(file, "utf8"))).code;
  }, `an OTP for ${mobile}`);
}

const emailMetaSchema = z.object({ to: z.string(), subject: z.string(), attachments: z.array(z.string()) });
export type OutboxEmail = z.infer<typeof emailMetaSchema> & { dir: string };

/** Finds an email in the console outbox matching `predicate`. */
export async function findEmail(predicate: (email: OutboxEmail) => boolean): Promise<OutboxEmail> {
  return poll(async () => {
    const dirs = await readdir(path.join(OUTBOX, "emails")).catch(() => []);
    for (const dir of dirs) {
      const meta = emailMetaSchema.parse(
        JSON.parse(await readFile(path.join(OUTBOX, "emails", dir, "email.json"), "utf8")),
      );
      const email = { ...meta, dir: path.join(OUTBOX, "emails", dir) };
      if (predicate(email)) return email;
    }
    return null;
  }, "an email in .outbox");
}

export async function readAttachment(email: OutboxEmail, name: string): Promise<Buffer> {
  return readFile(path.join(email.dir, name));
}

/** Looks up the user's subscription ids so the test can send a renewal webhook. */
export async function findSubscription(
  email: string,
): Promise<{ providerSubscriptionId: string; providerPlanId: string }> {
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  try {
    const rows = await sql<{ provider_subscription_id: string; provider_plan_id: string }[]>`
      select s.provider_subscription_id, s.provider_plan_id
      from subscriptions s join "user" u on u.id = s.user_id
      where u.email = ${email} order by s.created_at desc limit 1`;
    const row = rows[0];
    if (!row) throw new Error(`No subscription for ${email}`);
    return { providerSubscriptionId: row.provider_subscription_id, providerPlanId: row.provider_plan_id };
  } finally {
    await sql.end();
  }
}

/** A Razorpay-format subscription.charged webhook body and its signature. */
export function renewalWebhook(input: { subscriptionId: string; planId: string; amountPaise: number }) {
  const now = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_e2e",
    event: "subscription.charged",
    contains: ["subscription", "payment"],
    payload: {
      subscription: {
        entity: {
          id: input.subscriptionId,
          entity: "subscription",
          plan_id: input.planId,
          status: "active",
          current_start: now,
          current_end: now + 30 * 24 * 3600,
          paid_count: 2,
          total_count: 120,
          notes: [],
        },
      },
      payment: {
        entity: {
          id: `pay_e2e${now}`,
          entity: "payment",
          amount: input.amountPaise,
          currency: "INR",
          status: "captured",
          invoice_id: "inv_e2e",
          method: "upi",
          notes: [],
          created_at: now,
        },
      },
    },
    created_at: now + 1,
  });
  const signature = createHmac("sha256", FAKE_WEBHOOK_SECRET).update(body).digest("hex");
  return { body, signature, eventId: `evt_e2e_${now}` };
}
