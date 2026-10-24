import "server-only";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import type { BillingInterval, PlanKey } from "@/config/plans";
import { isPlanKey } from "@/config/plans";
import type { DbOrTx, Tx } from "../db/client";
import { getDb } from "../db/client";
import { subscriptions } from "../db/schema";
import { logger } from "../logger";
import type { PaymentProvider, ProviderSubscription, SubscriptionStatus } from "../providers/payments";
import { billingErrors } from "./errors";
import { ensureProviderPlan, findPlanByProviderPlanId } from "./provider-plans";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * Timestamp for a snapshot we fetched ourselves. Provider event times have one-second
 * resolution, so we round down: a webhook generated in the same second still applies.
 */
export function observedNow(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

const PRE_ACTIVATION: SubscriptionStatus[] = ["created", "authenticated"];

/** Statuses where the provider may still charge the customer. */
export const LIVE_STATUSES: SubscriptionStatus[] = [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "paused",
];

/**
 * Applies a provider snapshot (from a webhook or a fetch) to our row. Events older than the
 * last one applied are ignored, because webhooks can arrive out of order.
 */
export async function applySubscriptionSnapshot(
  tx: Tx,
  snapshot: ProviderSubscription,
  observedAt: Date,
): Promise<SubscriptionRow | null> {
  const [current] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, snapshot.id))
    .for("update");
  if (!current) return null;
  const sameSecond = current.lastEventAt?.getTime() === observedAt.getTime();
  const isOlder = current.lastEventAt !== null && observedAt < current.lastEventAt;
  // Within one second we can't order events, but a subscription never returns to pre-activation states.
  const isRegression =
    sameSecond && PRE_ACTIVATION.includes(snapshot.status) && !PRE_ACTIVATION.includes(current.status);
  if (isOlder || isRegression) {
    logger.info("Ignored stale subscription event", { subscriptionId: current.id, status: snapshot.status });
    return current;
  }

  let planFields: Partial<Pick<SubscriptionRow, "planKey" | "interval" | "amountPaise" | "providerPlanId">> = {};
  if (snapshot.planId !== current.providerPlanId) {
    const plan = await findPlanByProviderPlanId(tx, snapshot.planId);
    if (plan) {
      planFields = {
        planKey: plan.planKey,
        interval: plan.interval,
        amountPaise: plan.amountPaise,
        providerPlanId: snapshot.planId,
      };
    }
  }

  const [updated] = await tx
    .update(subscriptions)
    .set({
      status: snapshot.status,
      currentPeriodStart: snapshot.currentStart ?? current.currentPeriodStart,
      currentPeriodEnd: snapshot.currentEnd ?? current.currentPeriodEnd,
      paidCount: Math.max(current.paidCount, snapshot.paidCount),
      totalCount: snapshot.totalCount ?? current.totalCount,
      endedAt: snapshot.endedAt ?? current.endedAt,
      cancelledAt: snapshot.status === "cancelled" ? (current.cancelledAt ?? observedAt) : current.cancelledAt,
      lastEventAt: observedAt,
      ...planFields,
    })
    .where(eq(subscriptions.id, current.id))
    .returning();
  return updated ?? current;
}

/** The subscription to show on the billing page: live, or cancelled but still in its paid period. */
export async function getCurrentSubscription(db: DbOrTx, userId: string): Promise<SubscriptionRow | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        or(
          inArray(subscriptions.status, ["authenticated", "active", "pending", "halted", "paused"]),
          and(eq(subscriptions.status, "cancelled"), gt(subscriptions.currentPeriodEnd, new Date())),
        ),
      ),
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

async function requireLiveSubscription(userId: string): Promise<SubscriptionRow> {
  const [row] = await getDb()
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, ["authenticated", "active", "pending", "halted", "paused"]),
      ),
    )
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  if (!row) throw billingErrors.noSubscription();
  return row;
}

/** Cancels at the end of the paid period; access continues until then. */
export async function cancelSubscriptionAtPeriodEnd(
  provider: PaymentProvider,
  userId: string,
): Promise<SubscriptionRow> {
  const current = await requireLiveSubscription(userId);
  const snapshot = await provider.cancelSubscription(current.providerSubscriptionId, { atCycleEnd: true });
  return getDb().transaction(async (tx) => {
    const updated = await applySubscriptionSnapshot(tx, snapshot, observedNow());
    const [flagged] = await tx
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(subscriptions.id, current.id))
      .returning();
    return flagged ?? updated ?? current;
  });
}

/** Switches the live subscription to another plan/interval immediately (Razorpay prorates). */
export async function changeSubscriptionPlan(
  provider: PaymentProvider,
  userId: string,
  planKey: PlanKey,
  interval: BillingInterval,
): Promise<SubscriptionRow> {
  const current = await requireLiveSubscription(userId);
  if (isPlanKey(current.planKey) && current.planKey === planKey && current.interval === interval) return current;
  const db = getDb();
  const { providerPlanId } = await ensureProviderPlan(db, provider, planKey, interval);
  const snapshot = await provider.changeSubscriptionPlan(current.providerSubscriptionId, providerPlanId);
  return db.transaction(async (tx) => {
    const updated = await applySubscriptionSnapshot(tx, snapshot, observedNow());
    return updated ?? current;
  });
}

/** Stops all future charges immediately; used when a user deletes their account. */
export async function cancelAllSubscriptionsNow(provider: PaymentProvider | null, userId: string): Promise<void> {
  const live = await getDb()
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE_STATUSES)));
  for (const row of live) {
    if (!provider || row.provider !== provider.name) {
      logger.error("Cannot cancel subscription: provider not configured", {
        subscriptionId: row.id,
        provider: row.provider,
      });
      throw billingErrors.disabled();
    }
    const snapshot =
      row.status === "created"
        ? null
        : await provider.cancelSubscription(row.providerSubscriptionId, { atCycleEnd: false });
    await getDb().transaction(async (tx) => {
      if (snapshot) await applySubscriptionSnapshot(tx, snapshot, observedNow());
      else
        await tx
          .update(subscriptions)
          .set({ status: "cancelled", cancelledAt: new Date() })
          .where(eq(subscriptions.id, row.id));
    });
  }
}
