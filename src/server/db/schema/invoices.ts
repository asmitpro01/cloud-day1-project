import { sql } from "drizzle-orm";
import {
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { orders, payments, subscriptions } from "./billing";
import { createdAt, paiseColumn, timestamptz } from "./columns";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export type InvoiceParty = {
  name: string;
  addressLines: string[];
  stateCode: string;
  stateName: string;
  gstin: string | null;
  email: string | null;
};

export type InvoiceLineItem = {
  description: string;
  sacCode: string;
  quantity: number;
  taxablePaise: number;
};

/**
 * One running counter per invoice series per financial year. Incremented with an upsert inside
 * the invoice transaction: the row lock serialises concurrent invoices and a rollback undoes
 * the increment, so numbers have no gaps and no duplicates.
 */
export const invoiceSequences = pgTable(
  "invoice_sequences",
  {
    series: text("series").notNull(),
    financialYear: text("financial_year").notNull(),
    lastValue: integer("last_value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.series, table.financialYear] })],
);

/** Issued GST tax invoices. Immutable: buyer and seller details are snapshotted at issue time. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceNumber: varchar("invoice_number", { length: 16 }).notNull().unique(),
    series: text("series").notNull(),
    financialYear: text("financial_year").notNull(),
    sequence: integer("sequence").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    issuedAt: timestamptz("issued_at").notNull(),
    // Invoices outlive account deletion (CGST Act s.36 record keeping).
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id, { onDelete: "restrict" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    seller: jsonb("seller").$type<InvoiceParty>().notNull(),
    buyer: jsonb("buyer").$type<InvoiceParty>().notNull(),
    placeOfSupplyStateCode: char("place_of_supply_state_code", { length: 2 }).notNull(),
    supplyType: text("supply_type").notNull(),
    pricingMode: text("pricing_mode").notNull(),
    lineItems: jsonb("line_items").$type<InvoiceLineItem[]>().notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    taxablePaise: paiseColumn("taxable_paise").notNull(),
    cgstPaise: paiseColumn("cgst_paise").notNull(),
    sgstPaise: paiseColumn("sgst_paise").notNull(),
    utgstPaise: paiseColumn("utgst_paise").notNull(),
    igstPaise: paiseColumn("igst_paise").notNull(),
    totalTaxPaise: paiseColumn("total_tax_paise").notNull(),
    totalPaise: paiseColumn("total_paise").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    emailedAt: timestamptz("emailed_at"),
    createdAt: createdAt(),
  },
  (table) => [
    unique("invoices_series_fy_sequence_unique").on(table.series, table.financialYear, table.sequence),
    index("invoices_user_idx").on(table.userId),
    check("invoices_number_length_check", sql`char_length(${table.invoiceNumber}) <= 16`),
    check("invoices_supply_type_check", sql`${table.supplyType} in ('intra-state', 'inter-state')`),
    check(
      "invoices_totals_check",
      sql`${table.totalPaise} = ${table.taxablePaise} + ${table.cgstPaise} + ${table.sgstPaise} + ${table.utgstPaise} + ${table.igstPaise}`,
    ),
  ],
);

/** The rendered PDF, stored once so later template changes never alter an issued invoice. */
export const invoicePdfs = pgTable("invoice_pdfs", {
  invoiceId: uuid("invoice_id")
    .primaryKey()
    .references(() => invoices.id, { onDelete: "cascade" }),
  content: bytea("content").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: createdAt(),
});
