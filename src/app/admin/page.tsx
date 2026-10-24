import type { Metadata } from "next";
import { Suspense } from "react";
import { site } from "@/config/site";
import { formatINR } from "@/lib/money";
import { getAdminMetrics } from "@/server/admin/metrics";
import { requireAdmin } from "@/server/auth/session";
import { PageSkeleton } from "../dashboard/_components/page-skeleton";
import { StatCard } from "./_components/stat-card";

export const metadata: Metadata = { title: "Admin" };

async function Metrics() {
  await requireAdmin();
  const metrics = await getAdminMetrics();
  const churnPercent = (metrics.churnRateBps / 100).toFixed(1);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label="MRR (excl. GST)"
        value={formatINR(metrics.mrrPaise, { showPaise: false })}
        hint={`${formatINR(metrics.mrrIncludingGstPaise, { showPaise: false })} incl. GST · yearly plans ÷ 12`}
      />
      <StatCard
        label="Active subscriptions"
        value={metrics.activeSubscriptions.toLocaleString("en-IN")}
        hint={
          metrics.atRiskSubscriptions ? `${metrics.atRiskSubscriptions} with failed payments` : "No failed payments"
        }
      />
      <StatCard
        label="Churn this month"
        value={`${churnPercent}%`}
        hint={`${metrics.churnedThisMonth} ended since the 1st (IST)`}
      />
      <StatCard
        label="Collected this month"
        value={formatINR(metrics.revenueThisMonthPaise, { showPaise: false })}
        hint={`Incl. ${site.gst.rateBps / 100}% GST`}
      />
      <StatCard label="Users" value={metrics.totalUsers.toLocaleString("en-IN")} />
      <StatCard label="Waitlist" value={metrics.waitlistCount.toLocaleString("en-IN")} />
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Revenue in ₹, as of now.</p>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <Metrics />
      </Suspense>
    </div>
  );
}
