import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTimeIST } from "@/lib/dates";
import { listWaitlist } from "@/server/admin/queries";
import { requireAdmin } from "@/server/auth/session";
import { PageSkeleton } from "../../dashboard/_components/page-skeleton";
import { Pagination } from "../_components/pagination";
import { parseListParams } from "../_components/search-params";

export const metadata: Metadata = { title: "Waitlist · Admin" };

async function WaitlistTable({ searchParams }: { searchParams: PageProps<"/admin/waitlist">["searchParams"] }) {
  await requireAdmin();
  const { page } = parseListParams(await searchParams);
  const result = await listWaitlist({ page });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Confirmed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.email}</TableCell>
                <TableCell>{row.source ?? "—"}</TableCell>
                <TableCell>{formatDateTimeIST(row.createdAt)}</TableCell>
                <TableCell>{row.confirmationSentAt ? "Email sent" : "Pending"}</TableCell>
              </TableRow>
            ))}
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Nobody on the waitlist yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <Pagination basePath="/admin/waitlist" page={result.page} pageCount={result.pageCount} total={result.total} />
    </div>
  );
}

export default function AdminWaitlistPage({ searchParams }: PageProps<"/admin/waitlist">) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Waitlist</h1>
        <Button asChild variant="outline">
          <a href="/api/admin/waitlist/export" download>
            <DownloadIcon /> Export CSV
          </a>
        </Button>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <WaitlistTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
