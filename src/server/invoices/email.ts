import "server-only";
import { eq } from "drizzle-orm";
import { site } from "@/config/site";
import { InvoiceEmail } from "@/emails/invoice";
import { formatDateIST, istDateStringToDate } from "@/lib/dates";
import { invoiceFileName } from "@/lib/invoice-number";
import { formatINR, paise } from "@/lib/money";
import { getDb } from "../db/client";
import { invoices } from "../db/schema";
import { sendEmail } from "../email";
import { logger } from "../logger";
import { ensureInvoicePdf, getInvoice } from "./store";

/** Emails the invoice PDF to the buyer once. Phone-only accounts without an email are skipped. */
export async function sendInvoiceEmail(invoiceId: string): Promise<void> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.emailedAt) return;

  const pdf = await ensureInvoicePdf(invoice);
  if (!invoice.buyer.email) {
    logger.info("Invoice not emailed: buyer has no email address", { invoiceId });
    return;
  }

  const total = formatINR(paise(invoice.totalPaise));
  await sendEmail({
    to: invoice.buyer.email,
    subject: `${site.brand.name} tax invoice ${invoice.invoiceNumber} for ${total}`,
    template: InvoiceEmail({
      name: invoice.buyer.name,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: formatDateIST(istDateStringToDate(invoice.invoiceDate)),
      total,
      description: invoice.lineItems[0]?.description ?? site.gst.serviceDescription,
    }),
    attachments: [{ filename: invoiceFileName(invoice.invoiceNumber), content: pdf, contentType: "application/pdf" }],
    tags: { type: "invoice" },
  });
  await getDb().update(invoices).set({ emailedAt: new Date() }).where(eq(invoices.id, invoiceId));
}
