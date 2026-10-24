import { sql } from "drizzle-orm";
import { check, char, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { createdAt, timestamptz, updatedAt } from "./columns";

/** Billing identity used on GST invoices. `state_code` decides the place of supply. */
export const billingProfiles = pgTable(
  "billing_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    gstin: char("gstin", { length: 15 }),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    stateCode: char("state_code", { length: 2 }).notNull(),
    pincode: char("pincode", { length: 6 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check("billing_profiles_pincode_check", sql`${table.pincode} ~ '^[1-9][0-9]{5}$'`),
    check(
      "billing_profiles_gstin_state_check",
      sql`${table.gstin} is null or left(${table.gstin}, 2) = ${table.stateCode}`,
    ),
  ],
);

/** DPDP consent records: what was agreed to, which policy version, when and from where. */
export const userConsents = pgTable(
  "user_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: timestamptz("granted_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    withdrawnAt: timestamptz("withdrawn_at"),
    createdAt: createdAt(),
  },
  (table) => [index("user_consents_user_id_idx").on(table.userId)],
);
