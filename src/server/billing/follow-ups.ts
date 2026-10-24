/** Work that must happen after the database transaction commits (e.g. emailing an invoice). */
export type BillingFollowUp = { type: "send-invoice-email"; invoiceId: string };
