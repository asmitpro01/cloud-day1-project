import "server-only";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import { cache } from "react";
import {
  FREE_PLAN_KEY,
  getPlan,
  getProduct,
  isPlanKey,
  isProductKey,
  type Feature,
  type PlanKey,
} from "@/config/plans";
import { getDb } from "../db/client";
import { orders, subscriptions } from "../db/schema";

export type Entitlements = {
  /** The plan that grants access right now (`free` when nothing is paid). */
  planKey: PlanKey;
  features: ReadonlySet<Feature>;
  lifetimeProducts: string[];
};

/**
 * What a user may access. `pending` keeps access while Razorpay retries a failed charge;
 * `halted` revokes it; a cancelled subscription keeps access until its paid period ends.
 */
export const getEntitlements = cache(async (userId: string): Promise<Entitlements> => {
  const db = getDb();
  const [activeSubscriptions, paidOrders] = await Promise.all([
    db
      .select({ planKey: subscriptions.planKey })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          or(
            inArray(subscriptions.status, ["active", "pending"]),
            and(eq(subscriptions.status, "cancelled"), gt(subscriptions.currentPeriodEnd, new Date())),
          ),
        ),
      ),
    db
      .select({ productKey: orders.productKey })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.status, "paid"))),
  ]);

  const features = new Set<Feature>(getPlan(FREE_PLAN_KEY).features);
  let planKey: PlanKey = FREE_PLAN_KEY;
  for (const subscription of activeSubscriptions) {
    if (!isPlanKey(subscription.planKey)) continue;
    planKey = subscription.planKey;
    for (const feature of getPlan(subscription.planKey).features) features.add(feature);
  }
  const lifetimeProducts: string[] = [];
  for (const order of paidOrders) {
    if (!isProductKey(order.productKey)) continue;
    lifetimeProducts.push(order.productKey);
    for (const feature of getProduct(order.productKey).features) features.add(feature);
  }
  return { planKey, features, lifetimeProducts };
});

/** Server-side feature gate: `if (!(await hasAccess(user.id, "reports.export"))) …` */
export async function hasAccess(userId: string, feature: Feature): Promise<boolean> {
  return (await getEntitlements(userId)).features.has(feature);
}
