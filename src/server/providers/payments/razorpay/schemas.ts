import "server-only";
import { z } from "zod";
import { paise } from "@/lib/money";
import type { ProviderOrder, ProviderPayment, ProviderSubscription } from "../types";

// Razorpay sends `notes` as an object, or as [] when empty.
const notesSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .nullish()
  .transform((notes): Record<string, string> => {
    if (!notes || Array.isArray(notes)) return {};
    return Object.fromEntries(Object.entries(notes).map(([key, value]) => [key, String(value)]));
  });

const unixSeconds = z.number().int().nonnegative();
const optionalUnix = unixSeconds.nullish().transform((value) => (value ? new Date(value * 1000) : null));

export const razorpayPaymentSchema = z
  .object({
    id: z.string(),
    entity: z.literal("payment"),
    amount: z.number().int(),
    currency: z.string(),
    status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
    order_id: z.string().nullish(),
    invoice_id: z.string().nullish(),
    method: z.string().nullish(),
    error_code: z.string().nullish(),
    error_description: z.string().nullish(),
    notes: notesSchema,
    created_at: unixSeconds,
  })
  .transform((payment): ProviderPayment => ({
    id: payment.id,
    amountPaise: paise(payment.amount),
    currency: payment.currency,
    status: payment.status,
    orderId: payment.order_id ?? null,
    invoiceId: payment.invoice_id ?? null,
    method: payment.method ?? null,
    errorCode: payment.error_code ?? null,
    errorDescription: payment.error_description ?? null,
    createdAt: new Date(payment.created_at * 1000),
    notes: payment.notes,
  }));

export const razorpaySubscriptionSchema = z
  .object({
    id: z.string(),
    entity: z.literal("subscription"),
    plan_id: z.string(),
    status: z.enum([
      "created",
      "authenticated",
      "active",
      "pending",
      "halted",
      "cancelled",
      "completed",
      "paused",
      "expired",
    ]),
    current_start: optionalUnix,
    current_end: optionalUnix,
    ended_at: optionalUnix,
    paid_count: z.number().int().nonnegative().nullish(),
    total_count: z.number().int().nullish(),
    notes: notesSchema,
  })
  .transform((subscription): ProviderSubscription => ({
    id: subscription.id,
    planId: subscription.plan_id,
    status: subscription.status,
    currentStart: subscription.current_start,
    currentEnd: subscription.current_end,
    endedAt: subscription.ended_at,
    paidCount: subscription.paid_count ?? 0,
    totalCount: subscription.total_count ?? null,
    notes: subscription.notes,
  }));

export const razorpayOrderSchema = z
  .object({
    id: z.string(),
    entity: z.literal("order"),
    amount: z.number().int(),
    currency: z.string(),
    receipt: z.string().nullish(),
  })
  .transform((order): ProviderOrder => ({
    id: order.id,
    amountPaise: paise(order.amount),
    currency: order.currency,
    receipt: order.receipt ?? "",
  }));

export const razorpayPlanSchema = z.object({ id: z.string(), entity: z.literal("plan") });

export const razorpayErrorSchema = z.object({
  error: z.object({ code: z.string().optional(), description: z.string().optional(), reason: z.string().nullish() }),
});

/** Webhook envelope: https://razorpay.com/docs/webhooks/payloads/ */
export const razorpayWebhookSchema = z.object({
  entity: z.literal("event"),
  event: z.string(),
  created_at: unixSeconds,
  payload: z.object({
    payment: z.object({ entity: z.unknown() }).optional(),
    subscription: z.object({ entity: z.unknown() }).optional(),
  }),
});
