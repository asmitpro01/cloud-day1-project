import "server-only";
import { sql } from "drizzle-orm";
import { site } from "@/config/site";
import { financialYearOf } from "@/lib/dates";
import { formatInvoiceNumber } from "@/lib/invoice-number";
import type { Tx } from "../db/client";
import { invoiceSequences } from "../db/schema";

export type AllocatedInvoiceNumber = {
  invoiceNumber: string;
  series: string;
  financialYear: string;
  sequence: number;
};

/**
 * Takes the next number in the series for the IST financial year of `issuedAt`.
 * Must run inside the transaction that inserts the invoice: the upsert locks the counter row
 * until commit (no duplicates under concurrency) and a rollback returns the number (no gaps).
 * The counter starts again at 1 every 1 April because each FY has its own row.
 */
export async function allocateInvoiceNumber(
  tx: Tx,
  issuedAt: Date,
  series: string = site.invoice.prefix,
): Promise<AllocatedInvoiceNumber> {
  const fy = financialYearOf(issuedAt);
  const [row] = await tx
    .insert(invoiceSequences)
    .values({ series, financialYear: fy.label, lastValue: 1 })
    .onConflictDoUpdate({
      target: [invoiceSequences.series, invoiceSequences.financialYear],
      set: { lastValue: sql`${invoiceSequences.lastValue} + 1` },
    })
    .returning({ lastValue: invoiceSequences.lastValue });
  if (!row) throw new Error("Invoice sequence upsert returned no row");

  return {
    invoiceNumber: formatInvoiceNumber({
      prefix: series,
      financialYearCode: fy.code,
      sequence: row.lastValue,
      counterDigits: site.invoice.counterDigits,
    }),
    series,
    financialYear: fy.label,
    sequence: row.lastValue,
  };
}
