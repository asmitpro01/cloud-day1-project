import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPlan, isPlanKey } from "@/config/plans";
import { formatDateIST } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { listUsers } from "@/server/admin/queries";
import { requireAdmin } from "@/server/auth/session";
import { PageSkeleton } from "../../dashboard/_components/page-skeleton";
import { Pagination } from "../_components/pagination";
import { parseListParams } from "../_components/search-params";

export const metadata: Metadata = { title: "Users · Admin" };

async function UsersTable({ searchParams }: { searchParams: PageProps<"/admin/users">["searchParams"] }) {
  await requireAdmin();
  const { page, query } = parseListParams(await searchParams);
  const result = await listUsers({ page, query });
  return (
    <div className="space-y-4">
      <form className="flex max-w-md gap-2" role="search">
        <Input name="q" defaultValue={query} placeholder="Search name, email or phone" aria-label="Search users" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email / phone</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <div>
                    {row.email.endsWith("@users.invalid") ? (
                      <span className="text-muted-foreground">No email</span>
                    ) : (
                      row.email
                    )}
                  </div>
                  {row.phoneNumber ? (
                    <div className="text-xs text-muted-foreground">{formatPhone(row.phoneNumber)}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  {row.subscription && isPlanKey(row.subscription.planKey) ? (
                    <span>
                      {getPlan(row.subscription.planKey).name}{" "}
                      <span className="text-xs text-muted-foreground">({row.subscription.status})</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Free</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.role === "admin" ? <Badge>Admin</Badge> : <span className="text-muted-foreground">User</span>}
                </TableCell>
                <TableCell>{formatDateIST(row.createdAt)}</TableCell>
              </TableRow>
            ))}
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      <Pagination
        basePath="/admin/users"
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        query={query}
      />
    </div>
  );
}

export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Users</h1>
      <Suspense fallback={<PageSkeleton />}>
        <UsersTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
