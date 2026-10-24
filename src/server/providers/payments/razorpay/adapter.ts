import "server-only";
import type { BillingInterval } from "@/config/plans";
import { hmacSha256Hex, signaturesMatch } from "../signature";
import {
  HANDLED_SUBSCRIPTION_EVENTS,
  type CheckoutResponse,
  type PaymentProvider,
  type ProviderMode,
  type SubscriptionEventType,
  type WebhookEvent,
} from "../types";
import { createRazorpayClient } from "./client";
import {
  razorpayOrderSchema,
  razorpayPaymentSchema,
  razorpayPlanSchema,
  razorpaySubscriptionSchema,
  razorpayWebhookSchema,
} from "./schemas";

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  mode: ProviderMode;
};

const PERIOD: Record<BillingInterval, "monthly" | "yearly"> = { monthly: "monthly", yearly: "yearly" };

function isHandledSubscriptionEvent(type: string): type is SubscriptionEventType {
  return HANDLED_SUBSCRIPTION_EVENTS.some((handled) => handled === type);
}

/** Parses a Razorpay webhook body (already signature-verified) into a provider-agnostic event. */
export function parseRazorpayWebhook(rawBody: string): WebhookEvent {
  const envelope = razorpayWebhookSchema.parse(JSON.parse(rawBody));
  const createdAt = new Date(envelope.created_at * 1000);
  const paymentEntity = envelope.payload.payment?.entity;
  const payment = paymentEntity === undefined ? null : razorpayPaymentSchema.parse(paymentEntity);

  if (envelope.event === "payment.captured" || envelope.event === "payment.failed") {
    if (!payment) throw new Error(`${envelope.event} webhook without a payment entity`);
    return { type: envelope.event, createdAt, payment };
  }
  if (isHandledSubscriptionEvent(envelope.event)) {
    const subscriptionEntity = envelope.payload.subscription?.entity;
    if (subscriptionEntity === undefined) throw new Error(`${envelope.event} webhook without a subscription entity`);
    return {
      type: envelope.event,
      createdAt,
      subscription: razorpaySubscriptionSchema.parse(subscriptionEntity),
      payment,
    };
  }
  return { type: "ignored", rawType: envelope.event, createdAt };
}

/** Razorpay implementation of `PaymentProvider` (Orders, Subscriptions, Checkout, Webhooks). */
export function createRazorpayProvider(config: RazorpayConfig, fetchImpl: typeof fetch = fetch): PaymentProvider {
  const api = createRazorpayClient({ keyId: config.keyId, keySecret: config.keySecret }, fetchImpl);

  return {
    name: "razorpay",
    mode: config.mode,
    publicKey: config.keyId,

    async createPlan({ name, description, interval, amountPaise, notes }) {
      const plan = await api.post("/plans", razorpayPlanSchema, {
        period: PERIOD[interval],
        interval: 1,
        item: { name, description, amount: amountPaise, currency: "INR" },
        notes,
      });
      return { id: plan.id };
    },

    createOrder({ amountPaise, receipt, notes }) {
      return api.post("/orders", razorpayOrderSchema, { amount: amountPaise, currency: "INR", receipt, notes });
    },

    createSubscription({ planId, totalCount, notes }) {
      return api.post("/subscriptions", razorpaySubscriptionSchema, {
        plan_id: planId,
        total_count: totalCount,
        quantity: 1,
        customer_notify: 1,
        notes,
      });
    },

    fetchPayment(paymentId) {
      return api.get(`/payments/${encodeURIComponent(paymentId)}`, razorpayPaymentSchema);
    },

    capturePayment(paymentId, amountPaise) {
      return api.post(`/payments/${encodeURIComponent(paymentId)}/capture`, razorpayPaymentSchema, {
        amount: amountPaise,
        currency: "INR",
      });
    },

    fetchSubscription(subscriptionId) {
      return api.get(`/subscriptions/${encodeURIComponent(subscriptionId)}`, razorpaySubscriptionSchema);
    },

    cancelSubscription(subscriptionId, { atCycleEnd }) {
      return api.post(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, razorpaySubscriptionSchema, {
        cancel_at_cycle_end: atCycleEnd ? 1 : 0,
      });
    },

    changeSubscriptionPlan(subscriptionId, planId) {
      return api.patch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, razorpaySubscriptionSchema, {
        plan_id: planId,
        schedule_change_at: "now",
        customer_notify: 1,
      });
    },

    verifyCheckoutSignature(response: CheckoutResponse) {
      // Orders sign "order_id|payment_id"; subscriptions sign "payment_id|subscription_id".
      const payload =
        response.kind === "order"
          ? `${response.orderId}|${response.paymentId}`
          : `${response.paymentId}|${response.subscriptionId}`;
      return signaturesMatch(hmacSha256Hex(payload, config.keySecret), response.signature);
    },

    verifyWebhookSignature(rawBody, signature) {
      return signaturesMatch(hmacSha256Hex(rawBody, config.webhookSecret), signature);
    },

    parseWebhook: parseRazorpayWebhook,
  };
}
