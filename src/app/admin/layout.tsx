import { Suspense, type ReactNode } from "react";
import { requireAdmin } from "@/server/auth/session";
import { PageSkeleton } from "../dashboard/_components/page-skeleton";
import { AdminHeader, AdminHeaderShell, AdminMobileNav } from "./_components/admin-header";

/** Authoritative role check; non-admins get a 404. */
async function RequireAdmin({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <>
      <AdminMobileNav />
      {children}
    </>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Suspense fallback={<AdminHeaderShell />}>
        <AdminHeader />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Suspense fallback={<PageSkeleton />}>
          <RequireAdmin>{children}</RequireAdmin>
        </Suspense>
      </main>
    </div>
  );
}
