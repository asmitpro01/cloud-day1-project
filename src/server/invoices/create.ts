import "server-only";
import { eq } from "drizzle-orm";
import { getPlan, getProduct, isPlanKey, isProductKey } from "@/config/plans";
import { site } from "@/config/site";
import { formatDateIST, toIstDateString } from "@/lib/dates";
import { calculateGst } from "@/lib/gst/tax";
import { getGstState, type GstStateCode } from "@/lib/gst/states";
import { paise } from "@/lib/money";
import { getBillingProfile } from "../account/billing-profile";
import { isPlaceholderEmail } from "../auth/placeholder-email";
import type { Tx } from "../db/client";
import { invoices, orders, subscriptions, user, type InvoiceLineItem, type InvoiceParty } from "../db/schema";
import type { PaymentRow } from "../billing/payments";
import { allocateInvoiceNumber } from "./numbering";

export type InvoiceRow = typeof invoices.$inferSelect;

function sellerParty(): InvoiceParty {
  const { company } = site;
  const state = getGstState(company.address.stateCode);
  return {
    name: company.legalName,
    addressLines: [
      company.address.line1,
      ...(company.address.line2 ? [company.address.line2] : []),
      `${company.address.city} ${company.address.pincode}`,
    ],
    stateCode: state.code,
    stateName: state.name,
    gstin: company.gstin,
    email: company.email,
  };
}

async function describePurchase(tx: Tx, payment: PaymentRow): Promise<string> {
  if (payment.subscriptionId) {
    const [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.id, payment.subscriptionId));
    if (subscription && isPlanKey(subscription.planKey)) {
      const period =
        subscription.currentPeriodStart && subscription.currentPeriodEnd
          ? `, ${formatDateIST(subscription.currentPeriodStart)} to ${formatDateIST(subscription.currentPeriodEnd)}`
          : "";
      return `${getPlan(subscription.planKey).name} plan (${subscription.interval})${period}: ${site.gst.serviceDescription}`;
    }
  }
  if (payment.orderId) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId));
    if (order && isProductKey(order.productKey)) {
      return `${getProduct(order.productKey).name}: ${site.gst.serviceDescription}`;
    }
  }
  return site.gst.serviceDescription;
}

/**
 * Issues the GST tax invoice for a captured payment, once. Call inside the transaction that
 * recorded the payment (which holds the payment row lock, so concurrent callers serialise).
 * Tax is computed from the amount actually charged, so the invoice total always equals the payment.
 */
export async function createInvoiceForPayment(
  tx: Tx,
  payment: PaymentRow,
): Promise<{ invoice: InvoiceRow; created: boolean }> {
  const [existing] = await tx.select().from(invoices).where(eq(invoices.paymentId, payment.id));
  if (existing) return { invoice: existing, created: false };
  if (payment.status !== "captured") throw new Error(`Payment ${payment.id} is not captured`);

  const seller = sellerParty();
  const sellerStateCode: GstStateCode = site.company.address.stateCode;

  const [buyerUser] = payment.userId ? await tx.select().from(user).where(eq(user.id, payment.userId)) : [];
  const profile = payment.userId ? await getBillingProfile(tx, payment.userId) : null;
  // Place of supply is the buyer's state. Without an address on record it falls back to the
  // supplier's location (IGST Act s.12(2)(b)); checkout requires an address, so this is rare.
  const placeOfSupply: GstStateCode = profile?.stateCode ?? sellerStateCode;
  const posState = getGstState(placeOfSupply);
  const buyer: InvoiceParty = {
    name: profile?.legalName ?? buyerUser?.name ?? "Customer",
    addressLines: profile
      ? [
          profile.addressLine1,
          ...(profile.addressLine2 ? [profile.addressLine2] : []),
          `${profile.city} ${profile.pincode}`,
        ]
      : [],
    stateCode: posState.code,
    stateName: posState.name,
    gstin: profile?.gstin ?? null,
    email: buyerUser && !isPlaceholderEmail(buyerUser.email) ? buyerUser.email : null,
  };

  const tax = calculateGst({
    amountPaise: paise(payment.amountPaise),
    pricingMode: "inclusive",
    rateBps: site.gst.rateBps,
    sellerStateCode,
    placeOfSupplyStateCode: placeOfSupply,
  });
  const lineItems: InvoiceLineItem[] = [
    {
      description: await describePurchase(tx, payment),
      sacCode: site.gst.sacCode,
      quantity: 1,
      taxablePaise: tax.taxablePaise,
    },
  ];

  const issuedAt = new Date();
  const number = await allocateInvoiceNumber(tx, issuedAt);
  const [invoice] = await tx
    .insert(invoices)
    .values({
      ...number,
      invoiceDate: toIstDateString(issuedAt),
      issuedAt,
      userId: payment.userId,
      paymentId: payment.id,
      subscriptionId: payment.subscriptionId,
      orderId: payment.orderId,
      seller,
      buyer,
      placeOfSupplyStateCode: placeOfSupply,
      supplyType: tax.supplyType,
      pricingMode: site.gst.pricingMode,
      lineItems,
      taxRateBps: tax.rateBps,
      taxablePaise: tax.taxablePaise,
      cgstPaise: tax.cgstPaise,
      sgstPaise: tax.sgstPaise,
      utgstPaise: tax.utgstPaise,
      igstPaise: tax.igstPaise,
      totalTaxPaise: tax.totalTaxPaise,
      totalPaise: tax.totalPaise,
      providerPaymentId: payment.providerPaymentId,
    })
    .returning();
  if (!invoice) throw new Error("Invoice insert returned no row");
  return { invoice, created: true };
}
