import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, invoiceFileName, InvoiceNumberError } from "./invoice-number";

describe("formatInvoiceNumber", () => {
  it("formats prefix, financial year and padded counter", () => {
    expect(formatInvoiceNumber({ prefix: "INV", financialYearCode: "2627", sequence: 42, counterDigits: 6 })).toBe(
      "INV/2627/000042",
    );
  });

  it("stays within 16 characters", () => {
    expect(
      formatInvoiceNumber({ prefix: "ACME-IN", financialYearCode: "2627", sequence: 1, counterDigits: 3 }),
    ).toHaveLength(16);
    expect(() =>
      formatInvoiceNumber({ prefix: "ACME-IND", financialYearCode: "2627", sequence: 1, counterDigits: 3 }),
    ).toThrow(InvoiceNumberError);
  });

  it("refuses counters that overflow the configured digits", () => {
    expect(() =>
      formatInvoiceNumber({ prefix: "INV", financialYearCode: "2627", sequence: 1_000_000, counterDigits: 6 }),
    ).toThrow(/exceeds 6 digits/);
  });

  it("rejects characters GST doesn't allow and invalid sequences", () => {
    expect(() =>
      formatInvoiceNumber({ prefix: "inv", financialYearCode: "2627", sequence: 1, counterDigits: 6 }),
    ).toThrow(InvoiceNumberError);
    expect(() =>
      formatInvoiceNumber({ prefix: "INV", financialYearCode: "2627", sequence: 0, counterDigits: 6 }),
    ).toThrow(InvoiceNumberError);
  });

  it("builds a file name", () => {
    expect(invoiceFileName("INV/2627/000042")).toBe("INV-2627-000042.pdf");
  });
});
