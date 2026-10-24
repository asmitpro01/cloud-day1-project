import type { BillingInterval } from "@/config/plans";
import type { Paise } from "@/lib/money";

export type ProviderMode = "test" | "live";

export type PaymentStatus = "created" | "authorized" | "captured" | "failed" | "refunded";

export type SubscriptionStatus =
  "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "paused" | "expired";

export type ProviderPayment = {
  id: string;
  amountPaise: Paise;
  currency: string;
  status: PaymentStatus;
  /** Set for one-time payments made against an order. */
  orderId: string | null;
  /** Set for subscription charges (the provider's invoice for that cycle). */
  invoiceId: string | null;
  method: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  createdAt: Date;
  notes: Record<string, string>;
};

export type ProviderSubscription = {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  currentStart: Date | null;
  currentEnd: Date | null;
  endedAt: Date | null;
  paidCount: number;
  totalCount: number | null;
  notes: Record<string, string>;
};

export type ProviderOrder = {
  id: string;
  amountPaise: Paise;
  currency: string;
  receipt: string;
};

/** What the browser's Checkout returns after payment, to be verified on the server. */
export type CheckoutResponse =
  | { kind: "order"; orderId: string; paymentId: string; signature: string }
  | { kind: "subscription"; subscriptionId: string; paymentId: string; signature: string };

export const HANDLED_SUBSCRIPTION_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "subscription.paused",
  "subscription.resumed",
] as const;

export type SubscriptionEventType = (typeof HANDLED_SUBSCRIPTION_EVENTS)[number];

/** Provider-agnostic webhook event. Unknown event types are acknowledged and ignored. */
export type WebhookEvent =
  | { type: "payment.captured" | "payment.failed"; createdAt: Date; payment: ProviderPayment }
  | {
      type: SubscriptionEventType;
      createdAt: Date;
      subscription: ProviderSubscription;
      payment: ProviderPayment | null;
    }
  | { type: "ignored"; rawType: string; createdAt: Date };

/**
 * Everything the app needs from a payment gateway. Implement this to add Cashfree, PayU, etc.;
 * billing code depends only on this interface.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  /** Public key the browser checkout needs (Razorpay key_id). */
  readonly publicKey: string;

  createPlan(input: {
    name: string;
    description: string;
    interval: BillingInterval;
    amountPaise: Paise;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
  createOrder(input: { amountPaise: Paise; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder>;
  createSubscription(input: {
    planId: string;
    totalCount: number;
    notes: Record<string, string>;
  }): Promise<ProviderSubscription>;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  capturePayment(paymentId: string, amountPaise: Paise): Promise<ProviderPayment>;
  fetchSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  cancelSubscription(subscriptionId: string, options: { atCycleEnd: boolean }): Promise<ProviderSubscription>;
  changeSubscriptionPlan(subscriptionId: string, planId: string): Promise<ProviderSubscription>;

  /** Verifies the signature Checkout returns. Never trust client-reported payment status. */
  verifyCheckoutSignature(response: CheckoutResponse): boolean;
  /** Verifies a webhook signature over the exact raw request body. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  /** Parses a verified webhook body into a provider-agnostic event. */
  parseWebhook(rawBody: string): WebhookEvent;
}
