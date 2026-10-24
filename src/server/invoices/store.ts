import "server-only";
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { invoicePdfs, invoices } from "../db/schema";
import type { InvoiceRow } from "./create";
import { renderInvoicePdf } from "./pdf/render";

export async function getInvoice(invoiceId: string): Promise<InvoiceRow | null> {
  const [row] = await getDb().select().from(invoices).where(eq(invoices.id, invoiceId));
  return row ?? null;
}

export async function listInvoicesForUser(userId: string): Promise<InvoiceRow[]> {
  return getDb().select().from(invoices).where(eq(invoices.userId, userId)).orderBy(desc(invoices.issuedAt));
}

/**
 * Returns the stored PDF, rendering and storing it on first use. Rendering happens outside the
 * invoice transaction to keep the numbering lock short; the snapshot makes it deterministic.
 */
export async function ensureInvoicePdf(invoice: InvoiceRow): Promise<Buffer> {
  const db = getDb();
  const [stored] = await db
    .select({ content: invoicePdfs.content })
    .from(invoicePdfs)
    .where(eq(invoicePdfs.invoiceId, invoice.id));
  if (stored) return stored.content;

  const content = await renderInvoicePdf(invoice);
  await db
    .insert(invoicePdfs)
    .values({
      invoiceId: invoice.id,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      byteSize: content.byteLength,
    })
    .onConflictDoNothing();
  // If another request stored it first, serve that copy so every download is identical.
  const [winner] = await db
    .select({ content: invoicePdfs.content })
    .from(invoicePdfs)
    .where(eq(invoicePdfs.invoiceId, invoice.id));
  return winner?.content ?? content;
}
