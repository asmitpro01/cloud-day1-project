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
