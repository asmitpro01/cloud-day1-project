import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getPlan, getPlanPrice, PLANS, type BillingInterval, type PlanKey, isPlanKey } from "@/config/plans";
import { site } from "@/config/site";
import { paise, type Paise } from "@/lib/money";
import type { DbOrTx } from "../db/client";
import { providerPlans } from "../db/schema";
import type { PaymentProvider } from "../providers/payments";
import { billingErrors } from "./errors";

/** Total billing cycles requested from the provider: about ten years either way. */
export function totalCountFor(interval: BillingInterval): number {
  return interval === "yearly" ? 10 : 120;
}

async function findProviderPlan(
  db: DbOrTx,
  provider: PaymentProvider,
  planKey: PlanKey,
  interval: BillingInterval,
  amountPaise: Paise,
) {
  const [row] = await db
    .select()
    .from(providerPlans)
    .where(
      and(
        eq(providerPlans.provider, provider.name),
        eq(providerPlans.mode, provider.mode),
        eq(providerPlans.planKey, planKey),
        eq(providerPlans.interval, interval),
        eq(providerPlans.amountPaise, amountPaise),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Returns the provider plan id for a config plan at its current price, creating the plan at
 * the provider when the price is new. Older prices are marked inactive; their subscribers keep them.
 */
export async function ensureProviderPlan(
  db: DbOrTx,
  provider: PaymentProvider,
  planKey: PlanKey,
  interval: BillingInterval,
): Promise<{ providerPlanId: string; amountPaise: Paise; created: boolean }> {
  const amountPaise = getPlanPrice(planKey, interval);
  if (!amountPaise) throw billingErrors.notForSale();

  const existing = await findProviderPlan(db, provider, planKey, interval, amountPaise);
  if (existing) return { providerPlanId: existing.providerPlanId, amountPaise, created: false };

  const plan = getPlan(planKey);
  const remote = await provider.createPlan({
    name: `${site.brand.name} ${plan.name} (${interval})`,
    description: plan.description,
    interval,
    amountPaise,
    notes: { plan_key: planKey, interval },
  });
  const [inserted] = await db
    .insert(providerPlans)
    .values({
      provider: provider.name,
      mode: provider.mode,
      planKey,
      interval,
      amountPaise,
      providerPlanId: remote.id,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    // Another request created it at the same moment; use theirs.
    const winner = await findProviderPlan(db, provider, planKey, interval, amountPaise);
    if (!winner) throw new Error("Provider plan vanished after a concurrent insert");
    return { providerPlanId: winner.providerPlanId, amountPaise, created: false };
  }

  await db
    .update(providerPlans)
    .set({ active: false })
    .where(
      and(
        eq(providerPlans.provider, provider.name),
        eq(providerPlans.mode, provider.mode),
        eq(providerPlans.planKey, planKey),
        eq(providerPlans.interval, interval),
        ne(providerPlans.amountPaise, amountPaise),
      ),
    );
  return { providerPlanId: inserted.providerPlanId, amountPaise, created: true };
}

/** Creates provider plans for every paid plan and interval in `src/config/plans.ts`. */
export async function syncAllPlans(db: DbOrTx, provider: PaymentProvider) {
  const results: Array<{
    planKey: PlanKey;
    interval: BillingInterval;
    amountPaise: Paise;
    providerPlanId: string;
    created: boolean;
  }> = [];
  for (const plan of PLANS) {
    for (const interval of ["monthly", "yearly"] as const) {
      if (!plan.prices[interval]) continue;
      const result = await ensureProviderPlan(db, provider, plan.key, interval);
      results.push({ planKey: plan.key, interval, ...result });
    }
  }
  return results;
}

/** Maps a provider plan id back to the config plan it was created for. */
export async function findPlanByProviderPlanId(
  db: DbOrTx,
  providerPlanId: string,
): Promise<{ planKey: PlanKey; interval: BillingInterval; amountPaise: Paise } | null> {
  const [row] = await db.select().from(providerPlans).where(eq(providerPlans.providerPlanId, providerPlanId)).limit(1);
  if (!row || !isPlanKey(row.planKey)) return null;
  return { planKey: row.planKey, interval: row.interval, amountPaise: paise(row.amountPaise) };
}
