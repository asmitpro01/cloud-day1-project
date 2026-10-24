import { createHmac } from "node:crypto";

/**
 * Builders for Razorpay-shaped payloads, shared by integration tests and the Playwright smoke
 * test. Shapes follow https://razorpay.com/docs/webhooks/payloads/.
 */
export function paymentEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `pay_${Math.random().toString(36).slice(2, 16)}`,
    entity: "payment",
    amount: 49900,
    currency: "INR",
    status: "captured",
    order_id: null,
    invoice_id: "inv_test",
    method: "upi",
    captured: true,
    error_code: null,
    error_description: null,
    notes: [],
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

export function subscriptionEntity(
  id: string,
  planId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    entity: "subscription",
    plan_id: planId,
    status: "active",
    current_start: now,
    current_end: now + 30 * 24 * 3600,
    ended_at: null,
    paid_count: 1,
    total_count: 120,
    notes: { user_id: "u_1" },
    ...overrides,
  };
}

export function webhookBody(input: {
  event: string;
  createdAt?: number;
  payment?: Record<string, unknown>;
  subscription?: Record<string, unknown>;
}): string {
  const payload: Record<string, unknown> = {};
  if (input.payment) payload.payment = { entity: input.payment };
  if (input.subscription) payload.subscription = { entity: input.subscription };
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event: input.event,
    contains: Object.keys(payload),
    payload,
    created_at: input.createdAt ?? Math.floor(Date.now() / 1000),
  });
}

export function signHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
