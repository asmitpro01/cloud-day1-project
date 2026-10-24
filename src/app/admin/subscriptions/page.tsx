import type { Metadata } from "next";
import { Suspense } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPlan, isPlanKey } from "@/config/plans";
import { formatDateIST } from "@/lib/dates";
import { formatINR, paise } from "@/lib/money";
import { listSubscriptions } from "@/server/admin/queries";
import { requireAdmin } from "@/server/auth/session";
import { StatusBadge } from "../../dashboard/billing/_components/status-badge";
import { PageSkeleton } from "../../dashboard/_components/page-skeleton";
import { Pagination } from "../_components/pagination";
import { parseListParams } from "../_components/search-params";

export const metadata: Metadata = { title: "Subscriptions · Admin" };

async function SubscriptionsTable({
  searchParams,
}: {
  searchParams: PageProps<"/admin/subscriptions">["searchParams"];
}) {
  await requireAdmin();
  const { page } = parseListParams(await searchParams);
  const result = await listSubscriptions({ page });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Renews / ends</TableHead>
              <TableHead>Razorpay id</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.name ?? <span className="text-muted-foreground">Deleted user</span>}</TableCell>
                <TableCell>
                  {isPlanKey(row.planKey) ? getPlan(row.planKey).name : row.planKey} · {row.interval}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(paise(row.amountPaise))}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.cancelAtPeriodEnd ? (
                    <span className="ml-1 text-xs text-muted-foreground">cancels at period end</span>
                  ) : null}
                </TableCell>
                <TableCell>{row.currentPeriodEnd ? formatDateIST(row.currentPeriodEnd) : "—"}</TableCell>
                <TableCell className="font-mono text-xs">{row.providerSubscriptionId.slice(0, 24)}</TableCell>
              </TableRow>
            ))}
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No subscriptions yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <Pagination
        basePath="/admin/subscriptions"
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
      />
    </div>
  );
}

export default function AdminSubscriptionsPage({ searchParams }: PageProps<"/admin/subscriptions">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
      <Suspense fallback={<PageSkeleton />}>
        <SubscriptionsTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
