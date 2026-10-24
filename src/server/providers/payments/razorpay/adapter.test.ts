import { describe, expect, it, vi } from "vitest";
import { paise } from "@/lib/money";
import { paymentEntity, signHex, subscriptionEntity, webhookBody } from "../../../../../test/fixtures/razorpay";
import { createRazorpayProvider, parseRazorpayWebhook } from "./adapter";
import { RazorpayApiError } from "./client";

const config = {
  keyId: "rzp_test_abc",
  keySecret: "key_secret",
  webhookSecret: "webhook_secret",
  mode: "test" as const,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("checkout signatures", () => {
  const provider = createRazorpayProvider(config);

  it("verifies order payments: HMAC(order_id|payment_id)", () => {
    const signature = signHex("order_1|pay_1", config.keySecret);
    expect(provider.verifyCheckoutSignature({ kind: "order", orderId: "order_1", paymentId: "pay_1", signature })).toBe(
      true,
    );
    expect(provider.verifyCheckoutSignature({ kind: "order", orderId: "order_2", paymentId: "pay_1", signature })).toBe(
      false,
    );
  });

  it("verifies subscription payments: HMAC(payment_id|subscription_id)", () => {
    const signature = signHex("pay_1|sub_1", config.keySecret);
    expect(
      provider.verifyCheckoutSignature({
        kind: "subscription",
        subscriptionId: "sub_1",
        paymentId: "pay_1",
        signature,
      }),
    ).toBe(true);
    expect(
      provider.verifyCheckoutSignature({
        kind: "subscription",
        subscriptionId: "sub_1",
        paymentId: "pay_1",
        signature: "zz",
      }),
    ).toBe(false);
  });
});

describe("webhook signatures", () => {
  const provider = createRazorpayProvider(config);
  const body = webhookBody({ event: "payment.captured", payment: paymentEntity() });

  it("accepts the HMAC of the exact raw body", () => {
    expect(provider.verifyWebhookSignature(body, signHex(body, config.webhookSecret))).toBe(true);
  });

  it("rejects re-serialised bodies, wrong secrets and missing signatures", () => {
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(provider.verifyWebhookSignature(reserialised, signHex(body, config.webhookSecret))).toBe(false);
    expect(provider.verifyWebhookSignature(body, signHex(body, config.keySecret))).toBe(false);
    expect(provider.verifyWebhookSignature(body, null)).toBe(false);
    expect(provider.verifyWebhookSignature(body, "not-hex!")).toBe(false);
  });
});

describe("parseRazorpayWebhook", () => {
  it("parses payment events, including empty notes sent as []", () => {
    const event = parseRazorpayWebhook(
      webhookBody({
        event: "payment.captured",
        createdAt: 1_790_000_000,
        payment: paymentEntity({ id: "pay_x", order_id: "order_x" }),
      }),
    );
    expect(event).toMatchObject({
      type: "payment.captured",
      createdAt: new Date(1_790_000_000 * 1000),
      payment: { id: "pay_x", amountPaise: 49900, orderId: "order_x", status: "captured", notes: {} },
    });
  });

  it("parses subscription events with an optional payment", () => {
    const event = parseRazorpayWebhook(
      webhookBody({
        event: "subscription.charged",
        subscription: subscriptionEntity("sub_1", "plan_1", { current_end: 1_800_000_000 }),
        payment: paymentEntity({ id: "pay_y" }),
      }),
    );
    expect(event.type).toBe("subscription.charged");
    if (event.type !== "subscription.charged") return;
    expect(event.subscription).toMatchObject({
      id: "sub_1",
      planId: "plan_1",
      status: "active",
      currentEnd: new Date(1_800_000_000 * 1000),
    });
    expect(event.payment?.id).toBe("pay_y");
  });

  it("ignores events the app doesn't handle", () => {
    expect(parseRazorpayWebhook(webhookBody({ event: "refund.created" }))).toMatchObject({
      type: "ignored",
      rawType: "refund.created",
    });
  });

  it("rejects events missing their entity", () => {
    expect(() => parseRazorpayWebhook(webhookBody({ event: "subscription.halted" }))).toThrow(/subscription entity/);
  });
});

describe("Razorpay API client", () => {
  it("creates orders with Basic auth and paise amounts", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ id: "order_1", entity: "order", amount: 999900, currency: "INR", receipt: "rcpt_1" }),
    );
    const provider = createRazorpayProvider(config, fetchMock);
    const order = await provider.createOrder({
      amountPaise: paise(999900),
      receipt: "rcpt_1",
      notes: { user_id: "u1" },
    });

    expect(order).toEqual({ id: "order_1", amountPaise: 999900, currency: "INR", receipt: "rcpt_1" });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("rzp_test_abc:key_secret").toString("base64")}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: 999900,
      currency: "INR",
      receipt: "rcpt_1",
      notes: { user_id: "u1" },
    });
  });

  it("cancels at cycle end and changes plans", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(subscriptionEntity("sub_1", "plan_2")));
    const provider = createRazorpayProvider(config, fetchMock);
    await provider.cancelSubscription("sub_1", { atCycleEnd: true });
    await provider.changeSubscriptionPlan("sub_1", "plan_2");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.razorpay.com/v1/subscriptions/sub_1/cancel");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ cancel_at_cycle_end: 1 });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      plan_id: "plan_2",
      schedule_change_at: "now",
    });
  });

  it("surfaces Razorpay error descriptions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { code: "BAD_REQUEST_ERROR", description: "The amount must be atleast INR 1.00" } }, 400),
    );
    const provider = createRazorpayProvider(config, fetchMock);
    const error = await provider
      .createOrder({ amountPaise: paise(50), receipt: "r", notes: {} })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RazorpayApiError);
    expect(error instanceof RazorpayApiError && error.message).toBe("The amount must be atleast INR 1.00");
  });

  it("rejects unexpected response shapes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "x", entity: "refund" }));
    const provider = createRazorpayProvider(config, fetchMock);
    await expect(provider.fetchPayment("pay_1")).rejects.toThrow(/Unexpected Razorpay response/);
  });
});
