import { syncAllPlans } from "@/server/billing/provider-plans";
import { getDb } from "@/server/db/client";
import { formatINR } from "@/lib/money";
import { getPaymentProvider } from "@/server/providers/payments";

/** Creates a Razorpay plan for every paid plan + interval in src/config/plans.ts (idempotent). */
export async function syncPlans(): Promise<void> {
  const provider = getPaymentProvider();
  if (!provider) {
    console.log("• Skipping plan sync: PAYMENTS_PROVIDER is not set");
    return;
  }
  const results = await syncAllPlans(getDb(), provider);
  for (const result of results) {
    const status = result.created ? "created" : "exists ";
    console.log(
      `  ${status}  ${result.planKey.padEnd(10)} ${result.interval.padEnd(8)} ${formatINR(result.amountPaise).padStart(12)}  ${result.providerPlanId}`,
    );
  }
  console.log(`✓ ${results.length} ${provider.name} plans in sync (${provider.mode} mode)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncPlans()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("✗ Plan sync failed:", error);
      process.exit(1);
    });
}
