import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateIST, istDateStringToDate } from "@/lib/dates";
import { formatINR, paise } from "@/lib/money";
import { listInvoices } from "@/server/admin/queries";
import { requireAdmin } from "@/server/auth/session";
import { PageSkeleton } from "../../dashboard/_components/page-skeleton";
import { Pagination } from "../_components/pagination";
import { parseListParams } from "../_components/search-params";

export const metadata: Metadata = { title: "Invoices · Admin" };

async function InvoicesTable({ searchParams }: { searchParams: PageProps<"/admin/invoices">["searchParams"] }) {
  await requireAdmin();
  const { page } = parseListParams(await searchParams);
  const result = await listInvoices({ page });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Supply</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">GST</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <a
                    href={`/api/invoices/${row.id}/pdf`}
                    className="font-mono text-xs text-primary underline underline-offset-4"
                  >
                    {row.invoiceNumber}
                  </a>
                  {row.emailedAt ? null : (
                    <Badge variant="outline" className="ml-2">
                      not emailed
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{formatDateIST(istDateStringToDate(row.invoiceDate))}</TableCell>
                <TableCell>
                  <div>{row.buyer.name}</div>
                  <div className="text-xs text-muted-foreground">{row.buyer.gstin ?? "B2C"}</div>
                </TableCell>
                <TableCell>
                  {row.supplyType === "intra-state" ? "Intra" : "Inter"} · {row.placeOfSupplyStateCode}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(paise(row.taxablePaise))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatINR(paise(row.totalTaxPaise))}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatINR(paise(row.totalPaise))}
                </TableCell>
              </TableRow>
            ))}
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No invoices yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <Pagination basePath="/admin/invoices" page={result.page} pageCount={result.pageCount} total={result.total} />
    </div>
  );
}

export default function AdminInvoicesPage({ searchParams }: PageProps<"/admin/invoices">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
      <Suspense fallback={<PageSkeleton />}>
        <InvoicesTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
