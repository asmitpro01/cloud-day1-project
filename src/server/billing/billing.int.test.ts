import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FAKE_PAYMENTS_CREDENTIALS } from "@/env/schema";
import { paise } from "@/lib/money";
import { paymentEntity, subscriptionEntity, webhookBody } from "../../../test/fixtures/razorpay";
import { createTestUser } from "../../../test/fixtures/users";
import { getDb } from "../db/client";
import { orders, payments, subscriptions } from "../db/schema";
import { createFakeProvider } from "../providers/payments/fake";
import { startCheckout, verifyCheckout } from "./checkout";
import { getEntitlements, hasAccess } from "./entitlements";
import { cancelSubscriptionAtPeriodEnd } from "./subscriptions";
import { handleWebhookEvent } from "./webhooks";

const provider = createFakeProvider(FAKE_PAYMENTS_CREDENTIALS);

async function subscribe(planKey: "pro" | "business" = "pro") {
  const user = await createTestUser();
  const session = await startCheckout(provider, user, { kind: "subscription", planKey, interval: "monthly" });
  if (session.kind !== "subscription") throw new Error("expected subscription");
  const response = provider.simulateCheckout({
    kind: "subscription",
    subscriptionId: session.subscriptionId,
    amountPaise: session.amountPaise,
  });
  const result = await verifyCheckout(provider, user, response);
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, session.subscriptionId));
  if (!row) throw new Error("subscription row missing");
  return { user, session, response, result, row };
}

describe("subscription checkout", () => {
  it("requires a billing profile", async () => {
    const user = await createTestUser({ billing: false });
    await expect(
      startCheckout(provider, user, { kind: "subscription", planKey: "pro", interval: "monthly" }),
    ).rejects.toMatchObject({
      code: "BILLING_PROFILE_REQUIRED",
    });
  });

  it("activates only after a server-verified payment", async () => {
    const { user, result, row } = await subscribe();
    expect(result.status).toBe("captured");
    expect(row.status).toBe("active");
    expect(row.amountPaise).toBe(49900);
    expect(await hasAccess(user.id, "reports.export")).toBe(true);
    expect(await hasAccess(user.id, "team.invite")).toBe(false);
  });

  it("is idempotent when the browser retries verification", async () => {
    const { user, response } = await subscribe();
    await verifyCheckout(provider, user, response);
    const rows = await getDb().select().from(payments).where(eq(payments.providerPaymentId, response.paymentId));
    expect(rows).toHaveLength(1);
  });

  it("rejects forged signatures and other users' subscriptions", async () => {
    const { user, response } = await subscribe();
    await expect(verifyCheckout(provider, user, { ...response, signature: "0".repeat(64) })).rejects.toMatchObject({
      code: "INVALID_SIGNATURE",
    });
    const stranger = await createTestUser();
    await expect(verifyCheckout(provider, stranger, response)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("prevents a second live subscription", async () => {
    const { user } = await subscribe();
    await expect(
      startCheckout(provider, user, { kind: "subscription", planKey: "business", interval: "monthly" }),
    ).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
    });
  });

  it("keeps access after cancelling until the period ends", async () => {
    const { user } = await subscribe();
    const cancelled = await cancelSubscriptionAtPeriodEnd(provider, user.id);
    expect(cancelled.cancelAtPeriodEnd).toBe(true);
    expect(await hasAccess(user.id, "reports.export")).toBe(true);
  });
});

describe("one-time orders", () => {
  it("marks the order paid and grants lifetime features", async () => {
    const user = await createTestUser();
    const session = await startCheckout(provider, user, { kind: "order", productKey: "lifetime" });
    if (session.kind !== "order") throw new Error("expected order");
    const response = provider.simulateCheckout({ kind: "order", orderId: session.orderId, amountPaise: paise(999900) });
    await verifyCheckout(provider, user, response);
    const [order] = await getDb().select().from(orders).where(eq(orders.providerOrderId, session.orderId));
    expect(order?.status).toBe("paid");
    expect((await getEntitlements(user.id)).lifetimeProducts).toEqual(["lifetime"]);
  });

  it("rejects a payment whose amount doesn't match the order", async () => {
    const user = await createTestUser();
    const session = await startCheckout(provider, user, { kind: "order", productKey: "lifetime" });
    if (session.kind !== "order") throw new Error("expected order");
    const response = provider.simulateCheckout({ kind: "order", orderId: session.orderId, amountPaise: paise(100) });
    await expect(verifyCheckout(provider, user, response)).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });
});

describe("webhooks", () => {
  function event(body: string) {
    return provider.parseWebhook(body);
  }

  it("records a renewal from subscription.charged exactly once per event id", async () => {
    const { row } = await subscribe();
    const renewal = paymentEntity({ id: `pay_${randomUUID()}`, amount: 49900 });
    const body = webhookBody({
      event: "subscription.charged",
      subscription: subscriptionEntity(row.providerSubscriptionId, row.providerPlanId, { paid_count: 2 }),
      payment: renewal,
    });
    const eventId = `evt_${randomUUID()}`;

    const results = await Promise.all([
      handleWebhookEvent({ provider, eventId, event: event(body) }),
      handleWebhookEvent({ provider, eventId, event: event(body) }),
    ]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);

    const rows = await getDb().select().from(payments).where(eq(payments.subscriptionId, row.id));
    expect(rows).toHaveLength(2);
    const [updated] = await getDb().select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(updated?.paidCount).toBe(2);
  });

  it("ignores stale events that arrive out of order", async () => {
    const { user, row } = await subscribe();
    const now = Math.floor(Date.now() / 1000);
    const halted = webhookBody({
      event: "subscription.halted",
      createdAt: now + 60,
      subscription: subscriptionEntity(row.providerSubscriptionId, row.providerPlanId, { status: "halted" }),
    });
    const lateActivated = webhookBody({
      event: "subscription.activated",
      createdAt: now - 3600,
      subscription: subscriptionEntity(row.providerSubscriptionId, row.providerPlanId, { status: "active" }),
    });
    await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: event(halted) });
    await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: event(lateActivated) });

    const [updated] = await getDb().select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(updated?.status).toBe("halted");
    expect(await hasAccess(user.id, "reports.export")).toBe(false);
  });

  it("keeps access while a renewal is pending (retrying)", async () => {
    const { user, row } = await subscribe();
    const pending = webhookBody({
      event: "subscription.pending",
      createdAt: Math.floor(Date.now() / 1000) + 60,
      subscription: subscriptionEntity(row.providerSubscriptionId, row.providerPlanId, { status: "pending" }),
    });
    await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: event(pending) });
    expect(await hasAccess(user.id, "reports.export")).toBe(true);
  });

  it("never downgrades a captured payment", async () => {
    const user = await createTestUser();
    const session = await startCheckout(provider, user, { kind: "order", productKey: "lifetime" });
    if (session.kind !== "order") throw new Error("expected order");
    const paymentId = `pay_${randomUUID()}`;
    const captured = webhookBody({
      event: "payment.captured",
      payment: paymentEntity({ id: paymentId, order_id: session.orderId, amount: 999900 }),
    });
    const failed = webhookBody({
      event: "payment.failed",
      payment: paymentEntity({
        id: paymentId,
        order_id: session.orderId,
        amount: 999900,
        status: "failed",
        error_code: "BAD_REQUEST_ERROR",
      }),
    });
    await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: event(captured) });
    await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: event(failed) });
    const [row] = await getDb().select().from(payments).where(eq(payments.providerPaymentId, paymentId));
    expect(row?.status).toBe("captured");
    const [order] = await getDb().select().from(orders).where(eq(orders.providerOrderId, session.orderId));
    expect(order?.status).toBe("paid");
  });

  it("acknowledges payments for orders it doesn't track (e.g. Payment Pages)", async () => {
    const body = webhookBody({
      event: "payment.captured",
      payment: paymentEntity({ order_id: "order_from_payment_page" }),
    });
    const result = await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: event(body) });
    expect(result).toEqual({ duplicate: false, followUps: [] });
  });
});

describe("activation race", () => {
  it("applies a webhook from the same second as our fetch, but never regresses to pre-activation", async () => {
    const { row } = await subscribe();
    const sameSecond = row.lastEventAt ? Math.floor(row.lastEventAt.getTime() / 1000) : 0;
    const authenticated = webhookBody({
      event: "subscription.authenticated",
      createdAt: sameSecond,
      subscription: subscriptionEntity(row.providerSubscriptionId, row.providerPlanId, {
        status: "authenticated",
        paid_count: 0,
      }),
    });
    await handleWebhookEvent({ provider, eventId: `evt_${randomUUID()}`, event: provider.parseWebhook(authenticated) });
    const [updated] = await getDb().select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(updated?.status).toBe("active");
  });
});
