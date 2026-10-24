import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { BillingInterval } from "@/config/plans";
import { paise, type Paise } from "@/lib/money";
import { parseRazorpayWebhook } from "./razorpay/adapter";
import { hmacSha256Hex, signaturesMatch } from "./signature";
import type { CheckoutResponse, PaymentProvider, ProviderPayment, ProviderSubscription } from "./types";

/**
 * Offline stand-in for Razorpay, for local demos and automated tests (PAYMENTS_PROVIDER=fake).
 * It is stateless: ids encode what later lookups need. Checkout signatures and webhooks use
 * Razorpay's exact formats, so the real verification and webhook code paths are exercised.
 * Env validation refuses it in production.
 */
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value: string): unknown => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
const randomId = () => randomBytes(6).toString("hex");

const planIdSchema = z.string().regex(/^plan_fake_(monthly|yearly)_(\d+)_[0-9a-f]+$/);
const paymentPayloadSchema = z.object({
  amount: z.number().int(),
  orderId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  createdAt: z.number().int(),
});

function parsePlanId(planId: string): { interval: BillingInterval; amountPaise: Paise } {
  const match = planIdSchema.parse(planId).split("_");
  return { interval: match[2] === "yearly" ? "yearly" : "monthly", amountPaise: paise(Number(match[3])) };
}

function addInterval(date: Date, interval: BillingInterval): Date {
  const next = new Date(date);
  if (interval === "yearly") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function subscriptionSnapshot(
  subscriptionId: string,
  overrides: Partial<ProviderSubscription> = {},
): ProviderSubscription {
  const [, encodedPlan, createdMs] = subscriptionId.split(".");
  const planId = z.string().parse(decode(z.string().parse(encodedPlan)));
  const createdAt = new Date(Number(createdMs));
  const { interval } = parsePlanId(planId);
  return {
    id: subscriptionId,
    planId,
    status: "active",
    currentStart: createdAt,
    currentEnd: addInterval(createdAt, interval),
    endedAt: null,
    paidCount: 1,
    totalCount: interval === "yearly" ? 10 : 120,
    notes: {},
    ...overrides,
  };
}

export type FakeProvider = PaymentProvider & {
  /** What a successful Checkout would hand back to the browser, correctly signed. */
  simulateCheckout(
    target:
      | { kind: "order"; orderId: string; amountPaise: Paise }
      | { kind: "subscription"; subscriptionId: string; amountPaise: Paise },
  ): CheckoutResponse;
};

export function createFakeProvider(config: { keyId: string; keySecret: string; webhookSecret: string }): FakeProvider {
  const sign = (payload: string) => hmacSha256Hex(payload, config.keySecret);

  return {
    name: "fake",
    mode: "test",
    publicKey: config.keyId,

    async createPlan({ interval, amountPaise }) {
      return { id: `plan_fake_${interval}_${amountPaise}_${randomId()}` };
    },

    async createOrder({ amountPaise, receipt }) {
      return { id: `order_fake_${randomId()}`, amountPaise, currency: "INR", receipt };
    },

    async createSubscription({ planId, notes }) {
      const id = `sub_fake.${encode(planId)}.${Date.now()}.${randomId()}`;
      return subscriptionSnapshot(id, { status: "created", currentStart: null, currentEnd: null, paidCount: 0, notes });
    },

    async fetchPayment(paymentId): Promise<ProviderPayment> {
      const payload = paymentPayloadSchema.parse(decode(paymentId.replace(/^pay_fake\./, "")));
      return {
        id: paymentId,
        amountPaise: paise(payload.amount),
        currency: "INR",
        status: "captured",
        orderId: payload.orderId,
        invoiceId: payload.subscriptionId ? `inv_fake_${randomId()}` : null,
        method: "upi",
        errorCode: null,
        errorDescription: null,
        createdAt: new Date(payload.createdAt),
        notes: {},
      };
    },

    async capturePayment(paymentId) {
      return this.fetchPayment(paymentId);
    },

    async fetchSubscription(subscriptionId) {
      return subscriptionSnapshot(subscriptionId);
    },

    async cancelSubscription(subscriptionId, { atCycleEnd }) {
      return atCycleEnd
        ? subscriptionSnapshot(subscriptionId)
        : subscriptionSnapshot(subscriptionId, { status: "cancelled", endedAt: new Date() });
    },

    async changeSubscriptionPlan(subscriptionId, planId) {
      return subscriptionSnapshot(subscriptionId, { planId });
    },

    simulateCheckout(target) {
      const paymentId = `pay_fake.${encode({
        amount: target.amountPaise,
        orderId: target.kind === "order" ? target.orderId : null,
        subscriptionId: target.kind === "subscription" ? target.subscriptionId : null,
        createdAt: Date.now(),
      })}`;
      return target.kind === "order"
        ? { kind: "order", orderId: target.orderId, paymentId, signature: sign(`${target.orderId}|${paymentId}`) }
        : {
            kind: "subscription",
            subscriptionId: target.subscriptionId,
            paymentId,
            signature: sign(`${paymentId}|${target.subscriptionId}`),
          };
    },

    verifyCheckoutSignature(response) {
      const payload =
        response.kind === "order"
          ? `${response.orderId}|${response.paymentId}`
          : `${response.paymentId}|${response.subscriptionId}`;
      return signaturesMatch(sign(payload), response.signature);
    },

    verifyWebhookSignature(rawBody, signature) {
      return signaturesMatch(hmacSha256Hex(rawBody, config.webhookSecret), signature);
    },

    parseWebhook: parseRazorpayWebhook,
  };
}
