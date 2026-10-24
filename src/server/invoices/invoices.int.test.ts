import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FAKE_PAYMENTS_CREDENTIALS } from "@/env/schema";
import { createTestUser } from "../../../test/fixtures/users";
import { startCheckout, verifyCheckout } from "../billing/checkout";
import { runBillingFollowUps } from "../billing/follow-up-runner";
import { getDb } from "../db/client";
import { invoicePdfs, invoices, payments } from "../db/schema";
import { OUTBOX_DIR } from "../providers/email/console";
import { createFakeProvider } from "../providers/payments/fake";
import { allocateInvoiceNumber } from "./numbering";
import { ensureInvoicePdf } from "./store";

const provider = createFakeProvider(FAKE_PAYMENTS_CREDENTIALS);

async function buySubscription(stateCode: "27" | "29" | "04", gstin?: string) {
  const user = await createTestUser({ stateCode, gstin });
  const session = await startCheckout(provider, user, { kind: "subscription", planKey: "pro", interval: "monthly" });
  if (session.kind !== "subscription") throw new Error("expected subscription");
  const response = provider.simulateCheckout({
    kind: "subscription",
    subscriptionId: session.subscriptionId,
    amountPaise: session.amountPaise,
  });
  const result = await verifyCheckout(provider, user, response);
  const [payment] = await getDb().select().from(payments).where(eq(payments.providerPaymentId, response.paymentId));
  const [invoice] = await getDb()
    .select()
    .from(invoices)
    .where(eq(invoices.paymentId, payment?.id ?? ""));
  if (!invoice) throw new Error("invoice missing");
  return { user, response, result, invoice };
}

describe("invoice numbering", () => {
  it("issues unique, gap-free numbers under concurrency", async () => {
    const series = `T${randomUUID().slice(0, 2).toUpperCase()}`;
    const issuedAt = new Date("2026-10-24T10:00:00Z");
    const numbers = await Promise.all(
      Array.from({ length: 40 }, () => getDb().transaction((tx) => allocateInvoiceNumber(tx, issuedAt, series))),
    );
    const sequences = numbers.map((number) => number.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(new Set(numbers.map((number) => number.invoiceNumber)).size).toBe(40);
    expect(numbers[0]?.invoiceNumber).toMatch(new RegExp(`^${series}/2627/\\d{6}$`));
  });

  it("returns the number to the pool when the transaction rolls back", async () => {
    const series = `R${randomUUID().slice(0, 2).toUpperCase()}`;
    const issuedAt = new Date("2026-10-24T10:00:00Z");
    await getDb().transaction((tx) => allocateInvoiceNumber(tx, issuedAt, series));
    await getDb()
      .transaction(async (tx) => {
        await allocateInvoiceNumber(tx, issuedAt, series);
        throw new Error("PDF failed");
      })
      .catch(() => undefined);
    const next = await getDb().transaction((tx) => allocateInvoiceNumber(tx, issuedAt, series));
    expect(next.sequence).toBe(2);
  });

  it("restarts the counter on 1 April IST", async () => {
    const series = `F${randomUUID().slice(0, 2).toUpperCase()}`;
    const lastDayOfFy = new Date("2027-03-31T18:29:59Z"); // 31 Mar 23:59:59 IST
    const firstDayOfFy = new Date("2027-03-31T18:30:00Z"); // 1 Apr 00:00 IST
    const a = await getDb().transaction((tx) => allocateInvoiceNumber(tx, lastDayOfFy, series));
    const b = await getDb().transaction((tx) => allocateInvoiceNumber(tx, lastDayOfFy, series));
    const c = await getDb().transaction((tx) => allocateInvoiceNumber(tx, firstDayOfFy, series));
    expect([a.invoiceNumber, b.invoiceNumber, c.invoiceNumber]).toEqual([
      `${series}/2627/000001`,
      `${series}/2627/000002`,
      `${series}/2728/000001`,
    ]);
  });
});

describe("invoices for payments", () => {
  it("charges IGST for an inter-state buyer (Maharashtra seller → Karnataka)", async () => {
    const { invoice } = await buySubscription("29");
    expect(invoice).toMatchObject({
      supplyType: "inter-state",
      placeOfSupplyStateCode: "29",
      taxablePaise: 42_288,
      igstPaise: 7612,
      cgstPaise: 0,
      totalPaise: 49_900,
    });
    expect(invoice.invoiceNumber.length).toBeLessThanOrEqual(16);
    expect(invoice.lineItems[0]).toMatchObject({ sacCode: "998314", taxablePaise: 42_288 });
  });

  it("charges CGST + SGST for an intra-state buyer and snapshots the GSTIN", async () => {
    const { invoice } = await buySubscription("27", "27AAPFU0939F1ZV");
    expect(invoice).toMatchObject({ supplyType: "intra-state", cgstPaise: 3806, sgstPaise: 3806, igstPaise: 0 });
    expect(invoice.buyer.gstin).toBe("27AAPFU0939F1ZV");
    expect(invoice.seller.gstin).toBe("27AAPFU0939F1ZV");
  });

  it("issues one invoice per payment even when verification repeats", async () => {
    const { user, response, invoice } = await buySubscription("29");
    const again = await verifyCheckout(provider, user, response);
    expect(again.followUps).toEqual([]);
    const rows = await getDb().select().from(invoices).where(eq(invoices.paymentId, invoice.paymentId));
    expect(rows).toHaveLength(1);
  });

  it("renders a PDF once and emails it as an attachment", async () => {
    const { invoice, result } = await buySubscription("29");
    expect(result.followUps).toEqual([{ type: "send-invoice-email", invoiceId: invoice.id }]);

    const pdf = await ensureInvoicePdf(invoice);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const again = await ensureInvoicePdf(invoice);
    expect(again.equals(pdf)).toBe(true);
    const stored = await getDb().select().from(invoicePdfs).where(eq(invoicePdfs.invoiceId, invoice.id));
    expect(stored).toHaveLength(1);

    await runBillingFollowUps(result.followUps);
    const [emailed] = await getDb().select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(emailed?.emailedAt).toBeInstanceOf(Date);

    const dirs = await readdir(path.join(OUTBOX_DIR, "emails"));
    const emailMetaSchema = z.object({ subject: z.string(), attachments: z.array(z.string()) });
    const metas = await Promise.all(
      dirs.map(async (dir) =>
        emailMetaSchema.parse(JSON.parse(await readFile(path.join(OUTBOX_DIR, "emails", dir, "email.json"), "utf8"))),
      ),
    );
    const sent = metas.find((meta) => meta.subject.includes(invoice.invoiceNumber));
    expect(sent?.attachments).toEqual([`${invoice.invoiceNumber.replaceAll("/", "-")}.pdf`]);
  });
});
