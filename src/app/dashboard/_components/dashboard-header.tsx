import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/server/auth/session";
import { DASHBOARD_LINKS } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

export function DashboardHeaderShell({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
        <Logo href="/dashboard" />
        <div className="flex items-center gap-1">{children}</div>
      </div>
    </header>
  );
}

/** Reads the session, so it renders inside a Suspense boundary (Cache Components). */
export async function DashboardHeader() {
  const user = await requireUser();
  const links = user.isAdmin ? [...DASHBOARD_LINKS, { href: "/admin", label: "Admin" }] : DASHBOARD_LINKS;
  return (
    <DashboardHeaderShell>
      <nav aria-label="Dashboard" className="mr-2 hidden items-center gap-4 text-sm sm:flex">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <ThemeToggle />
      <SignOutButton />
    </DashboardHeaderShell>
  );
}

export function DashboardMobileNav() {
  return (
    <nav aria-label="Dashboard sections" className="mb-6 flex gap-4 overflow-x-auto text-sm sm:hidden">
      {DASHBOARD_LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="shrink-0 text-muted-foreground hover:text-foreground">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
