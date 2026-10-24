import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props = { basePath: string; page: number; pageCount: number; total: number; query?: string };

function href(basePath: string, page: number, query?: string): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

export function Pagination({ basePath, page, pageCount, total, query }: Props) {
  return (
    <div className="flex items-center justify-between gap-4 pt-4 text-sm text-muted-foreground">
      <p>
        {total.toLocaleString("en-IN")} total · page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          aria-disabled={page <= 1}
          className={page <= 1 ? "pointer-events-none opacity-50" : ""}
        >
          <Link href={href(basePath, Math.max(1, page - 1), query)}>Previous</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          size="sm"
          aria-disabled={page >= pageCount}
          className={page >= pageCount ? "pointer-events-none opacity-50" : ""}
        >
          <Link href={href(basePath, Math.min(pageCount, page + 1), query)}>Next</Link>
        </Button>
      </div>
    </div>
  );
}
