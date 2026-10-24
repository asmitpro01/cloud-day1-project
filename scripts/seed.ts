import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { site } from "@/config/site";
import { serverEnv } from "@/env/server";
import { rupees, type Paise } from "@/lib/money";
import { saveBillingProfile } from "@/server/account/billing-profile";
import { getDb, type Tx } from "@/server/db/client";
import { account, payments, subscriptions, user, userConsents, waitlistEntries } from "@/server/db/schema";
import { createInvoiceForPayment } from "@/server/invoices/create";

/** Demo invoices use their own series so they never consume your real invoice numbers. */
const DEMO_SERIES = "DEMO";
export const DEMO_PASSWORD = "demo-password-123";

type DemoCustomer = {
  name: string;
  email: string;
  phone: string;
  stateCode: "27" | "29" | "07" | "04" | "33";
  city: string;
  pincode: string;
  gstin?: string;
  plan: { key: "pro" | "business"; interval: "monthly" | "yearly"; amount: Paise } | null;
};

const CUSTOMERS: DemoCustomer[] = [
  {
    name: "Aarav Mehta",
    email: "aarav@example.com",
    phone: "+919800000001",
    stateCode: "27",
    city: "Mumbai",
    pincode: "400001",
    plan: { key: "pro", interval: "monthly", amount: rupees(499) },
  },
  {
    name: "Diya Rao",
    email: "diya@example.com",
    phone: "+919800000002",
    stateCode: "29",
    city: "Bengaluru",
    pincode: "560001",
    gstin: "29AAGCB7383J1Z4",
    plan: { key: "business", interval: "yearly", amount: rupees(14990) },
  },
  {
    name: "Kabir Singh",
    email: "kabir@example.com",
    phone: "+919800000003",
    stateCode: "07",
    city: "New Delhi",
    pincode: "110001",
    plan: { key: "pro", interval: "yearly", amount: rupees(4990) },
  },
  {
    name: "Meher Gill",
    email: "meher@example.com",
    phone: "+919800000004",
    stateCode: "04",
    city: "Chandigarh",
    pincode: "160017",
    plan: { key: "pro", interval: "monthly", amount: rupees(499) },
  },
  {
    name: "Ishaan Iyer",
    email: "ishaan@example.com",
    phone: "+919800000005",
    stateCode: "33",
    city: "Chennai",
    pincode: "600002",
    plan: null,
  },
];

async function createUser(
  db: Tx,
  input: { name: string; email: string; phone?: string; role?: "admin" | "user"; passwordHash: string },
) {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: input.name,
    email: input.email,
    emailVerified: true,
    phoneNumber: input.phone ?? null,
    phoneNumberVerified: input.phone ? true : null,
    role: input.role ?? "user",
  });
  await db
    .insert(account)
    .values({ id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: input.passwordHash });
  await db.insert(userConsents).values({
    userId: id,
    purpose: "terms_and_privacy",
    policyVersion: site.legal.privacyPolicyVersion,
    grantedAt: new Date(),
    ipAddress: "127.0.0.1",
    userAgent: "seed",
  });
  return id;
}

/** Loads demo users, subscriptions, payments, invoices and waitlist entries into a development database. */
export async function seed(): Promise<void> {
  const env = serverEnv();
  if (env.isProduction || (env.payments.provider === "razorpay" && env.payments.mode === "live")) {
    throw new Error("Refusing to seed a production database");
  }
  const db = getDb();
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, "admin@example.com"));
  if (existing) {
    console.log("• Demo data already present (admin@example.com exists)");
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  // One transaction: a failure leaves the database untouched, so the seed can simply be re-run.
  await db.transaction(async (tx) => {
    await seedAll(tx, passwordHash);
  });
  console.log(
    `✓ Seeded demo data. Sign in as admin@example.com or aarav@example.com with password "${DEMO_PASSWORD}".`,
  );
}

async function seedAll(tx: Tx, passwordHash: string): Promise<void> {
  await createUser(tx, { name: "Admin", email: "admin@example.com", role: "admin", passwordHash });

  const now = Date.now();
  for (const [index, customer] of CUSTOMERS.entries()) {
    const userId = await createUser(tx, { ...customer, passwordHash });
    await saveBillingProfile(tx, userId, {
      legalName: customer.gstin ? `${customer.name.split(" ")[1]} Technologies LLP` : customer.name,
      gstin: customer.gstin,
      addressLine1: `${10 + index} Demo Road`,
      addressLine2: undefined,
      city: customer.city,
      stateCode: customer.stateCode,
      pincode: customer.pincode,
    });
    if (!customer.plan) continue;

    const startedAt = new Date(now - (index + 1) * 5 * 24 * 3600 * 1000);
    const periodEnd = new Date(startedAt);
    if (customer.plan.interval === "yearly") periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
    else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    {
      const [subscription] = await tx
        .insert(subscriptions)
        .values({
          userId,
          planKey: customer.plan?.key ?? "pro",
          interval: customer.plan?.interval ?? "monthly",
          amountPaise: customer.plan?.amount ?? rupees(499),
          provider: "fake",
          providerSubscriptionId: `sub_demo_${randomUUID().slice(0, 12)}`,
          providerPlanId: "plan_demo",
          status: "active",
          currentPeriodStart: startedAt,
          currentPeriodEnd: periodEnd,
          paidCount: 1,
          createdAt: startedAt,
          lastEventAt: startedAt,
        })
        .returning();
      if (!subscription) throw new Error("Demo subscription insert failed");
      const [payment] = await tx
        .insert(payments)
        .values({
          userId,
          provider: "fake",
          providerPaymentId: `pay_demo_${randomUUID().slice(0, 12)}`,
          subscriptionId: subscription.id,
          amountPaise: subscription.amountPaise,
          status: "captured",
          method: index % 2 === 0 ? "upi" : "card",
          capturedAt: startedAt,
          createdAt: startedAt,
        })
        .returning();
      if (!payment) throw new Error("Demo payment insert failed");
      await createInvoiceForPayment(tx, payment, { series: DEMO_SERIES, issuedAt: startedAt });
    }
  }

  await tx
    .insert(waitlistEntries)
    .values(
      ["Priya", "Rohan", "Ananya", "Vikram"].map((name, index) => ({
        name,
        email: `${name.toLowerCase()}@example.com`,
        emailNormalized: `${name.toLowerCase()}@example.com`,
        source: index % 2 === 0 ? "landing" : "twitter",
        confirmationSentAt: new Date(),
      })),
    )
    .onConflictDoNothing();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("✗ Seed failed:", error);
      process.exit(1);
    });
}
