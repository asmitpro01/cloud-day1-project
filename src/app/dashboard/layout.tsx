import { Suspense, type ReactNode } from "react";
import { requireUser } from "@/server/auth/session";
import { DashboardHeader, DashboardHeaderShell, DashboardMobileNav } from "./_components/dashboard-header";
import { PageSkeleton } from "./_components/page-skeleton";

/** Authoritative session check: proxy.ts only looks for a cookie. */
async function RequireUser({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Suspense fallback={<DashboardHeaderShell />}>
        <DashboardHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <DashboardMobileNav />
        <Suspense fallback={<PageSkeleton />}>
          <RequireUser>{children}</RequireUser>
        </Suspense>
      </main>
    </div>
  );
}
