import "server-only";
import type { InvoiceRow } from "./create";

/**
 * FUTURE EXTENSION, not wired up. See docs/e-invoicing.md.
 *
 * Businesses above the e-invoicing turnover threshold must register each B2B invoice with
 * the Invoice Registration Portal (IRP) and print the returned IRN and signed QR code.
 * Implement this interface with your GSP/IRP provider, then call it after
 * `createInvoiceForPayment` for invoices where `requiresEInvoice()` is true.
 */
export interface EInvoiceProvider {
  readonly name: string;
  /** Submits the invoice (INV-01 JSON schema) and returns the IRP's acknowledgement. */
  generateIrn(invoice: InvoiceRow): Promise<IrnResult>;
  /** Cancels an IRN, allowed within 24 hours of generation. */
  cancelIrn(irn: string, reason: IrnCancelReason, remarks: string): Promise<void>;
}

export type IrnResult = {
  /** 64-character Invoice Reference Number (a hash computed by the IRP). */
  irn: string;
  ackNumber: string;
  ackDate: Date;
  /** Signed JWT to encode in the invoice's QR code. */
  signedQrCode: string;
  signedInvoice: string;
};

/** IRP cancellation reason codes: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other. */
export type IrnCancelReason = 1 | 2 | 3 | 4;

/**
 * Whether an invoice would need an IRN: only B2B supplies (buyer has a GSTIN), and only when
 * your aggregate turnover crosses the notified threshold. B2C invoices never need an IRN.
 */
export function requiresEInvoice(invoice: Pick<InvoiceRow, "buyer">, options: { enabled: boolean }): boolean {
  return options.enabled && invoice.buyer.gstin !== null;
}
