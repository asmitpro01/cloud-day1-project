import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../../../test/fixtures/users";
import { getDb } from "../db/client";
import { subscriptions } from "../db/schema";
import { getAdminMetrics } from "./metrics";

async function insertSubscription(values: {
  userId: string;
  interval: "monthly" | "yearly";
  amountPaise: number;
  status: "active" | "pending" | "halted" | "cancelled";
  createdAt?: Date;
  endedAt?: Date;
}) {
  await getDb()
    .insert(subscriptions)
    .values({
      userId: values.userId,
      planKey: "pro",
      interval: values.interval,
      amountPaise: values.amountPaise,
      provider: "fake",
      providerSubscriptionId: `sub_${randomUUID()}`,
      providerPlanId: "plan_test",
      status: values.status,
      currentPeriodStart: values.createdAt ?? new Date(),
      createdAt: values.createdAt ?? new Date(),
      endedAt: values.endedAt ?? null,
    });
}

describe("getAdminMetrics", () => {
  it("normalises yearly plans to monthly, excludes GST and counts churn in the IST month", async () => {
    const before = await getAdminMetrics();
    const user = await createTestUser();
    const lastMonth = new Date(Date.now() - 40 * 24 * 3600 * 1000);

    await insertSubscription({ userId: user.id, interval: "monthly", amountPaise: 49_900, status: "active" });
    await insertSubscription({ userId: user.id, interval: "monthly", amountPaise: 49_900, status: "pending" });
    await insertSubscription({ userId: user.id, interval: "yearly", amountPaise: 4_99_000, status: "active" });
    await insertSubscription({
      userId: user.id,
      interval: "monthly",
      amountPaise: 49_900,
      status: "halted",
      createdAt: lastMonth,
      endedAt: new Date(),
    });

    const after = await getAdminMetrics();
    // 499 + 499 + 4990/12 (= 415.83 → 41,583 paise) gross per month.
    expect(after.mrrIncludingGstPaise - before.mrrIncludingGstPaise).toBe(49_900 + 49_900 + 41_583);
    expect(after.activeSubscriptions - before.activeSubscriptions).toBe(3);
    expect(after.atRiskSubscriptions - before.atRiskSubscriptions).toBe(2);
    expect(after.churnedThisMonth - before.churnedThisMonth).toBe(1);
    expect(after.churnRateBps).toBeGreaterThan(0);
    // Net MRR backs out 18% GST from the gross.
    expect(Math.abs(after.mrrPaise - Math.round((after.mrrIncludingGstPaise * 10_000) / 11_800))).toBeLessThanOrEqual(
      1,
    );
  });
});
