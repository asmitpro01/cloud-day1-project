import { index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./columns";

/** Fixed-window counters for `src/server/rate-limit.ts`. Keys look like `otp:phone:+9198…`. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [index("rate_limits_expires_at_idx").on(table.expiresAt)],
);

/**
 * Webhook idempotency: one row per provider event id (`x-razorpay-event-id`), inserted in the
 * same transaction as the event's side effects so a failed handler is retried, not skipped.
 */
export const processedEvents = pgTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamptz("received_at").notNull().defaultNow(),
});
