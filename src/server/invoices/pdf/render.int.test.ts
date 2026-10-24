import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./render";
import type { InvoiceRow } from "../create";

const invoice: InvoiceRow = {
  id: "00000000-0000-0000-0000-000000000001",
  invoiceNumber: "INV/2627/000042",
  series: "INV",
  financialYear: "2026-27",
  sequence: 42,
  invoiceDate: "2026-10-24",
  issuedAt: new Date("2026-10-24T10:00:00Z"),
  userId: null,
  paymentId: "00000000-0000-0000-0000-000000000002",
  subscriptionId: null,
  orderId: null,
  seller: {
    name: "Example Technologies Private Limited",
    addressLines: ["Office 401", "Mumbai 400051"],
    stateCode: "27",
    stateName: "Maharashtra",
    gstin: "27AAPFU0939F1ZV",
    email: "billing@example.com",
  },
  buyer: {
    name: "Chandigarh Buyer",
    addressLines: ["Sector 17"],
    stateCode: "04",
    stateName: "Chandigarh",
    gstin: null,
    email: null,
  },
  placeOfSupplyStateCode: "04",
  supplyType: "intra-state",
  pricingMode: "inclusive",
  lineItems: [{ description: "Pro plan (monthly)", sacCode: "998314", quantity: 1, taxablePaise: 42_288 }],
  taxRateBps: 1800,
  taxablePaise: 42_288,
  cgstPaise: 3806,
  sgstPaise: 0,
  utgstPaise: 3806,
  igstPaise: 0,
  totalTaxPaise: 7612,
  totalPaise: 49_900,
  providerPaymentId: "pay_" + "x".repeat(60),
  emailedAt: null,
  createdAt: new Date("2026-10-24T10:00:00Z"),
};

describe("renderInvoicePdf", () => {
  it("renders a UTGST invoice with long references", async () => {
    const pdf = await renderInvoicePdf(invoice);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(5_000);
  });
});
