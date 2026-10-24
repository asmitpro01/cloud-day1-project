import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/server/auth/session";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/subscriptions", label: "Subscriptions" },
  { href: "/admin/invoices", label: "Invoices" },
  { href: "/admin/waitlist", label: "Waitlist" },
];

export function AdminHeaderShell({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2">
          <Logo href="/admin" />
          <Badge variant="secondary">Admin</Badge>
        </div>
        <div className="flex items-center gap-1">{children}</div>
      </div>
    </header>
  );
}

/** Rendered only for admins, so the admin navigation isn't shown to anyone else. */
export async function AdminHeader() {
  await requireAdmin();
  return (
    <AdminHeaderShell>
      <nav aria-label="Admin" className="mr-2 hidden items-center gap-4 text-sm md:flex">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
        <Link href="/dashboard" className="text-muted-foreground transition-colors hover:text-foreground">
          ← App
        </Link>
      </nav>
      <ThemeToggle />
    </AdminHeaderShell>
  );
}

export function AdminMobileNav() {
  return (
    <nav aria-label="Admin sections" className="mb-6 flex gap-4 overflow-x-auto text-sm md:hidden">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="shrink-0 text-muted-foreground hover:text-foreground">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
