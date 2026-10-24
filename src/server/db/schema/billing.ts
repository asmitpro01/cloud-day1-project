import { sql } from "drizzle-orm";
import { boolean, char, check, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, paiseColumn, timestamptz, updatedAt } from "./columns";

export const billingIntervalEnum = pgEnum("billing_interval", ["monthly", "yearly"]);

/** Razorpay subscription states, stored verbatim. */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "cancelled",
  "completed",
  "paused",
  "expired",
]);

export const orderStatusEnum = pgEnum("order_status", ["created", "paid", "failed"]);

export const paymentStatusEnum = pgEnum("payment_status", ["created", "authorized", "captured", "failed", "refunded"]);

/**
 * Maps a config plan + interval + price to the provider's plan id. Razorpay plans are
 * immutable, so changing a price creates a new row; test and live ids differ, so they
 * live here rather than in config.
 */
export const providerPlans = pgTable(
  "provider_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    planKey: text("plan_key").notNull(),
    interval: billingIntervalEnum("interval").notNull(),
    amountPaise: paiseColumn("amount_paise").notNull(),
    providerPlanId: text("provider_plan_id").notNull().unique(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("provider_plans_lookup_idx").on(
      table.provider,
      table.mode,
      table.planKey,
      table.interval,
      table.amountPaise,
    ),
    check("provider_plans_mode_check", sql`${table.mode} in ('test', 'live')`),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Set null (not cascade) on account deletion: invoices reference subscriptions for tax records.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    planKey: text("plan_key").notNull(),
    interval: billingIntervalEnum("interval").notNull(),
    amountPaise: paiseColumn("amount_paise").notNull(),
    provider: text("provider").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull().unique(),
    providerPlanId: text("provider_plan_id").notNull(),
    status: subscriptionStatusEnum("status").notNull().default("created"),
    currentPeriodStart: timestamptz("current_period_start"),
    currentPeriodEnd: timestamptz("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    cancelledAt: timestamptz("cancelled_at"),
    endedAt: timestamptz("ended_at"),
    paidCount: integer("paid_count").notNull().default(0),
    totalCount: integer("total_count"),
    /** Provider timestamp of the newest event applied; older webhook deliveries are ignored. */
    lastEventAt: timestamptz("last_event_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("subscriptions_user_status_idx").on(table.userId, table.status),
    check("subscriptions_amount_check", sql`${table.amountPaise} > 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    productKey: text("product_key").notNull(),
    amountPaise: paiseColumn("amount_paise").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id").notNull().unique(),
    receipt: text("receipt").notNull().unique(),
    status: orderStatusEnum("status").notNull().default("created"),
    createdAt: createdAt(),
    paidAt: timestamptz("paid_at"),
  },
  (table) => [index("orders_user_idx").on(table.userId), check("orders_amount_check", sql`${table.amountPaise} > 0`)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull().unique(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    amountPaise: paiseColumn("amount_paise").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    status: paymentStatusEnum("status").notNull(),
    method: text("method"),
    errorCode: text("error_code"),
    errorDescription: text("error_description"),
    capturedAt: timestamptz("captured_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("payments_user_created_idx").on(table.userId, table.createdAt),
    index("payments_subscription_idx").on(table.subscriptionId),
  ],
);
