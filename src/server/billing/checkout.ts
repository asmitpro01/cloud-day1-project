import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getPlan, getProduct, type BillingInterval, type PlanKey, type ProductKey } from "@/config/plans";
import { site } from "@/config/site";
import { paise, type Paise } from "@/lib/money";
import { getBillingProfile } from "../account/billing-profile";
import type { CurrentUser } from "../auth/session";
import { getDb } from "../db/client";
import { orders, subscriptions } from "../db/schema";
import { logger } from "../logger";
import type { CheckoutResponse, PaymentProvider } from "../providers/payments";
import { billingErrors } from "./errors";
import type { BillingFollowUp } from "./follow-ups";
import { afterPaymentCaptured, upsertPayment } from "./payments";
import { chargeAmountPaise } from "./pricing";
import { ensureProviderPlan, totalCountFor } from "./provider-plans";
import { applySubscriptionSnapshot, getCurrentSubscription, observedNow } from "./subscriptions";

export type CheckoutRequest =
  { kind: "subscription"; planKey: PlanKey; interval: BillingInterval } | { kind: "order"; productKey: ProductKey };

type Prefill = { name: string; email?: string; contact?: string };

/** Everything the browser needs to open Checkout. Contains no secrets. */
export type CheckoutSession = {
  provider: string;
  keyId: string;
  amountPaise: Paise;
  merchantName: string;
  description: string;
  prefill: Prefill;
} & ({ kind: "subscription"; subscriptionId: string } | { kind: "order"; orderId: string });

function prefillFor(user: CurrentUser): Prefill {
  return {
    name: user.name,
    ...(user.hasRealEmail ? { email: user.email } : {}),
    ...(user.phoneNumber ? { contact: user.phoneNumber } : {}),
  };
}

/** Creates the provider subscription or order and our pending record. Payment happens in the browser. */
export async function startCheckout(
  provider: PaymentProvider,
  user: CurrentUser,
  request: CheckoutRequest,
): Promise<CheckoutSession> {
  const db = getDb();
  // Place of supply comes from the billing state, so it's required before any charge.
  if (!(await getBillingProfile(db, user.id))) throw billingErrors.profileRequired();

  const base = {
    provider: provider.name,
    keyId: provider.publicKey,
    merchantName: site.brand.name,
    prefill: prefillFor(user),
  };

  if (request.kind === "subscription") {
    if (await getCurrentSubscription(db, user.id)) throw billingErrors.alreadySubscribed();
    const plan = getPlan(request.planKey);
    const { providerPlanId, amountPaise } = await ensureProviderPlan(db, provider, request.planKey, request.interval);
    const remote = await provider.createSubscription({
      planId: providerPlanId,
      totalCount: totalCountFor(request.interval),
      notes: { user_id: user.id, plan_key: plan.key, interval: request.interval },
    });
    await db.insert(subscriptions).values({
      userId: user.id,
      planKey: plan.key,
      interval: request.interval,
      amountPaise,
      provider: provider.name,
      providerSubscriptionId: remote.id,
      providerPlanId,
      status: "created",
      totalCount: remote.totalCount,
    });
    return {
      ...base,
      kind: "subscription",
      subscriptionId: remote.id,
      amountPaise,
      description: `${plan.name} plan, billed ${request.interval}`,
    };
  }

  const product = getProduct(request.productKey);
  const amountPaise = chargeAmountPaise(product.price);
  const receipt = `rcpt_${randomUUID().replaceAll("-", "")}`;
  const remote = await provider.createOrder({
    amountPaise,
    receipt,
    notes: { user_id: user.id, product_key: product.key },
  });
  await db.insert(orders).values({
    userId: user.id,
    productKey: product.key,
    amountPaise,
    provider: provider.name,
    providerOrderId: remote.id,
    receipt,
  });
  return { ...base, kind: "order", orderId: remote.id, amountPaise, description: product.name };
}

export type VerifiedCheckout = {
  status: "captured" | "authorized" | "failed" | "created" | "refunded";
  followUps: BillingFollowUp[];
};

/**
 * Called with what Checkout returned. Trusts nothing from the browser: verifies the HMAC
 * signature, then fetches the payment from the provider and records that.
 */
export async function verifyCheckout(
  provider: PaymentProvider,
  user: CurrentUser,
  response: CheckoutResponse,
): Promise<VerifiedCheckout> {
  if (!provider.verifyCheckoutSignature(response)) {
    logger.warn("Checkout signature mismatch", { userId: user.id, kind: response.kind });
    throw billingErrors.invalidSignature();
  }
  const db = getDb();

  if (response.kind === "order") {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.providerOrderId, response.orderId), eq(orders.userId, user.id)))
      .limit(1);
    if (!order) throw billingErrors.notFound();

    let payment = await provider.fetchPayment(response.paymentId);
    if (payment.orderId !== order.providerOrderId) throw billingErrors.invalidSignature();
    if (payment.amountPaise !== paise(order.amountPaise)) throw billingErrors.amountMismatch();
    // Accounts without auto-capture leave payments "authorized"; capture so the customer is charged.
    if (payment.status === "authorized") payment = await provider.capturePayment(payment.id, payment.amountPaise);

    return db.transaction(async (tx) => {
      const row = await upsertPayment(tx, {
        provider: provider.name,
        payment,
        userId: user.id,
        orderId: order.id,
        subscriptionId: null,
      });
      if (row.status !== "captured") return { status: row.status, followUps: [] };
      await tx.update(orders).set({ status: "paid", paidAt: new Date() }).where(eq(orders.id, order.id));
      return { status: row.status, followUps: await afterPaymentCaptured(tx, row) };
    });
  }

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.providerSubscriptionId, response.subscriptionId), eq(subscriptions.userId, user.id)))
    .limit(1);
  if (!subscription) throw billingErrors.notFound();

  const [payment, snapshot] = await Promise.all([
    provider.fetchPayment(response.paymentId),
    provider.fetchSubscription(response.subscriptionId),
  ]);

  return db.transaction(async (tx) => {
    await applySubscriptionSnapshot(tx, snapshot, observedNow());
    const row = await upsertPayment(tx, {
      provider: provider.name,
      payment,
      userId: user.id,
      orderId: null,
      subscriptionId: subscription.id,
    });
    if (row.status !== "captured") return { status: row.status, followUps: [] };
    return { status: row.status, followUps: await afterPaymentCaptured(tx, row) };
  });
}
