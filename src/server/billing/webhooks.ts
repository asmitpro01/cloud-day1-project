import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { getDb } from "../db/client";
import { orders, processedEvents } from "../db/schema";
import { logger } from "../logger";
import type { PaymentProvider, WebhookEvent } from "../providers/payments";
import type { BillingFollowUp } from "./follow-ups";
import { afterPaymentCaptured, upsertPayment } from "./payments";
import { applySubscriptionSnapshot } from "./subscriptions";

export type WebhookResult = { duplicate: boolean; followUps: BillingFollowUp[] };

async function handlePaymentEvent(
  tx: Tx,
  provider: PaymentProvider,
  event: Extract<WebhookEvent, { type: "payment.captured" | "payment.failed" }>,
): Promise<BillingFollowUp[]> {
  const { payment } = event;
  // Subscription charges are recorded from subscription.charged, which also carries the subscription.
  if (!payment.orderId) return [];

  const [order] = await tx.select().from(orders).where(eq(orders.providerOrderId, payment.orderId)).for("update");
  if (!order) {
    // e.g. a Razorpay Payment Page sale (the landing page pre-order), which this app doesn't track.
    logger.info("Webhook payment for an order we don't track", { paymentId: payment.id, event: event.type });
    return [];
  }

  const row = await upsertPayment(tx, {
    provider: provider.name,
    payment,
    userId: order.userId,
    orderId: order.id,
    subscriptionId: null,
  });
  if (row.status !== "captured") return [];
  if (order.status !== "paid") {
    await tx.update(orders).set({ status: "paid", paidAt: new Date() }).where(eq(orders.id, order.id));
  }
  return afterPaymentCaptured(tx, row);
}

async function handleSubscriptionEvent(
  tx: Tx,
  provider: PaymentProvider,
  event: Extract<WebhookEvent, { subscription: unknown }>,
): Promise<BillingFollowUp[]> {
  const subscription = await applySubscriptionSnapshot(tx, event.subscription, event.createdAt);
  if (!subscription) {
    logger.info("Webhook for a subscription we don't track", { providerSubscriptionId: event.subscription.id });
    return [];
  }
  if (!event.payment) return [];
  const row = await upsertPayment(tx, {
    provider: provider.name,
    payment: event.payment,
    userId: subscription.userId,
    orderId: null,
    subscriptionId: subscription.id,
  });
  return row.status === "captured" ? afterPaymentCaptured(tx, row) : [];
}

/**
 * Processes a verified webhook exactly once per event id. The `processed_events` insert and
 * the side effects share one transaction: a crash rolls both back and the provider's retry
 * is processed; a duplicate delivery hits the primary key and is skipped.
 */
export async function handleWebhookEvent(input: {
  provider: PaymentProvider;
  eventId: string;
  event: WebhookEvent;
}): Promise<WebhookResult> {
  const { provider, eventId, event } = input;
  const eventType = event.type === "ignored" ? event.rawType : event.type;

  return getDb().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(processedEvents)
      .values({ eventId, provider: provider.name, eventType })
      .onConflictDoNothing()
      .returning({ eventId: processedEvents.eventId });
    if (!inserted) return { duplicate: true, followUps: [] };

    switch (event.type) {
      case "payment.captured":
      case "payment.failed":
        return { duplicate: false, followUps: await handlePaymentEvent(tx, provider, event) };
      case "ignored":
        return { duplicate: false, followUps: [] };
      default:
        return { duplicate: false, followUps: await handleSubscriptionEvent(tx, provider, event) };
    }
  });
}
