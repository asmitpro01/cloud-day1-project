import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./columns";

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull().unique(),
    source: text("source"),
    createdAt: createdAt(),
    confirmationSentAt: timestamptz("confirmation_sent_at"),
  },
  (table) => [index("waitlist_entries_created_at_idx").on(table.createdAt)],
);
