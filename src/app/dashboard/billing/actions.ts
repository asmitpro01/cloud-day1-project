"use server";

import { after } from "next/server";
import { z } from "zod";
import { isPlanKey, isProductKey, type PlanKey, type ProductKey } from "@/config/plans";
import { AppError, publicErrorMessage } from "@/lib/errors";
import { paise } from "@/lib/money";
import { fail, failValidation, ok, type ActionResult } from "@/lib/result";
import { getCurrentUser } from "@/server/auth/session";
import { startCheckout, verifyCheckout, type CheckoutSession, type VerifiedCheckout } from "@/server/billing/checkout";
import { runBillingFollowUps } from "@/server/billing/follow-up-runner";
import { cancelSubscriptionAtPeriodEnd, changeSubscriptionPlan } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { getFakePaymentProvider, getPaymentProvider, type CheckoutResponse } from "@/server/providers/payments";
import { enforceRateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { and, eq } from "drizzle-orm";
import { orders, subscriptions } from "@/server/db/schema";

const planKeySchema = z.custom<PlanKey>((value) => typeof value === "string" && isPlanKey(value), "Unknown plan");
const productKeySchema = z.custom<ProductKey>(
  (value) => typeof value === "string" && isProductKey(value),
  "Unknown product",
);
const intervalSchema = z.enum(["monthly", "yearly"]);

const checkoutRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subscription"), planKey: planKeySchema, interval: intervalSchema }),
  z.object({ kind: z.literal("order"), productKey: productKeySchema }),
]);

const checkoutResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("order"),
    orderId: z.string().min(1),
    paymentId: z.string().min(1),
    signature: z.string().min(1),
  }),
  z.object({
    kind: z.literal("subscription"),
    subscriptionId: z.string().min(1),
    paymentId: z.string().min(1),
    signature: z.string().min(1),
  }),
]);

function failFrom(error: unknown, context: string) {
  if (error instanceof AppError) return fail(error.code, error.message);
  logger.error(`${context} failed`, { error });
  return fail("INTERNAL", publicErrorMessage(error));
}

export async function startCheckoutAction(input: unknown): Promise<ActionResult<CheckoutSession>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const provider = getPaymentProvider();
  if (!provider) return fail("BILLING_DISABLED", "Payments are not configured.");
  const parsed = checkoutRequestSchema.safeParse(input);
  if (!parsed.success) return failValidation(parsed.error);

  try {
    await enforceRateLimit(`checkout:user:${user.id}`, RATE_LIMITS.checkoutPerUser);
    return ok(await startCheckout(provider, user, parsed.data));
  } catch (error) {
    return failFrom(error, "startCheckout");
  }
}

/** Never marks anything paid on the client's word: the server verifies the signature and asks the provider. */
export async function verifyCheckoutAction(
  input: unknown,
): Promise<ActionResult<{ status: VerifiedCheckout["status"] }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const provider = getPaymentProvider();
  if (!provider) return fail("BILLING_DISABLED", "Payments are not configured.");
  const parsed = checkoutResponseSchema.safeParse(input);
  if (!parsed.success) return failValidation(parsed.error);

  try {
    const result = await verifyCheckout(provider, user, parsed.data);
    if (result.followUps.length > 0) after(() => runBillingFollowUps(result.followUps));
    return ok({ status: result.status });
  } catch (error) {
    return failFrom(error, "verifyCheckout");
  }
}

/** Test mode only: what Razorpay Checkout would return after a successful payment. */
export async function simulateFakeCheckoutAction(input: unknown): Promise<ActionResult<CheckoutResponse>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const fake = getFakePaymentProvider();
  if (!fake) return fail("NOT_AVAILABLE", "The payment simulator is only available with PAYMENTS_PROVIDER=fake.");
  const parsed = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("order"), orderId: z.string() }),
      z.object({ kind: z.literal("subscription"), subscriptionId: z.string() }),
    ])
    .safeParse(input);
  if (!parsed.success) return failValidation(parsed.error);

  const db = getDb();
  if (parsed.data.kind === "order") {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.providerOrderId, parsed.data.orderId), eq(orders.userId, user.id)));
    if (!order) return fail("NOT_FOUND", "Order not found.");
    return ok(
      fake.simulateCheckout({ kind: "order", orderId: order.providerOrderId, amountPaise: paise(order.amountPaise) }),
    );
  }
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(
      and(eq(subscriptions.providerSubscriptionId, parsed.data.subscriptionId), eq(subscriptions.userId, user.id)),
    );
  if (!subscription) return fail("NOT_FOUND", "Subscription not found.");
  return ok(
    fake.simulateCheckout({
      kind: "subscription",
      subscriptionId: subscription.providerSubscriptionId,
      amountPaise: paise(subscription.amountPaise),
    }),
  );
}

export async function cancelSubscriptionAction(): Promise<ActionResult<{ message: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const provider = getPaymentProvider();
  if (!provider) return fail("BILLING_DISABLED", "Payments are not configured.");
  try {
    await cancelSubscriptionAtPeriodEnd(provider, user.id);
    return ok({ message: "Your subscription will end at the close of the current billing period." });
  } catch (error) {
    return failFrom(error, "cancelSubscription");
  }
}

export async function changePlanAction(input: unknown): Promise<ActionResult<{ message: string }>> {
  const user = await getCurrentUser();
  if (!user) return fail("UNAUTHENTICATED", "Please sign in again.");
  const provider = getPaymentProvider();
  if (!provider) return fail("BILLING_DISABLED", "Payments are not configured.");
  const parsed = z.object({ planKey: planKeySchema, interval: intervalSchema }).safeParse(input);
  if (!parsed.success) return failValidation(parsed.error);
  try {
    await changeSubscriptionPlan(provider, user.id, parsed.data.planKey, parsed.data.interval);
    return ok({ message: "Plan changed. Razorpay adjusts the next charge for the switch." });
  } catch (error) {
    return failFrom(error, "changePlan");
  }
}
