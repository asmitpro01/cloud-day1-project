/** CGST Rule 46(b): at most 16 characters from A-Z, 0-9, "-" and "/", unique within a financial year. */
export const MAX_INVOICE_NUMBER_LENGTH = 16;
const ALLOWED = /^[A-Z0-9/-]+$/;

export class InvoiceNumberError extends RangeError {}

/** `INV` + FY `2627` + sequence 42 (6 digits) → `INV/2627/000042`. */
export function formatInvoiceNumber(input: {
  prefix: string;
  financialYearCode: string;
  sequence: number;
  counterDigits: number;
}): string {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new InvoiceNumberError(`Invalid invoice sequence ${input.sequence}`);
  }
  const counter = String(input.sequence).padStart(input.counterDigits, "0");
  if (counter.length > input.counterDigits) {
    throw new InvoiceNumberError(
      `Invoice counter ${input.sequence} exceeds ${input.counterDigits} digits for FY ${input.financialYearCode}`,
    );
  }
  const value = `${input.prefix}/${input.financialYearCode}/${counter}`;
  if (value.length > MAX_INVOICE_NUMBER_LENGTH || !ALLOWED.test(value)) {
    throw new InvoiceNumberError(`Invoice number ${value} breaks the 16-character GST rule`);
  }
  return value;
}

/** Turns an invoice number into a safe file name: `INV/2627/000042` → `INV-2627-000042.pdf`. */
export function invoiceFileName(invoiceNumber: string): string {
  return `${invoiceNumber.replaceAll("/", "-")}.pdf`;
}
