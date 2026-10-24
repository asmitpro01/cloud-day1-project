import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlan } from "@/config/plans";
import { getBillingProfile } from "@/server/account/billing-profile";
import { requireUser } from "@/server/auth/session";
import { getEntitlements } from "@/server/billing/entitlements";
import { getDb } from "@/server/db/client";
import { PageSkeleton } from "./_components/page-skeleton";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const user = await requireUser();
  const [billingProfile, entitlements] = await Promise.all([
    getBillingProfile(getDb(), user.id),
    getEntitlements(user.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Namaste, {user.name.split(" ")[0]} 👋</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening with your account.</p>
      </div>

      {!user.hasRealEmail ? (
        <Alert>
          <AlertTitle>Add your email</AlertTitle>
          <AlertDescription>
            We need an email address to send your GST invoices.{" "}
            <Link href="/dashboard/settings#email" className="underline">
              Add it in settings
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : !user.emailVerified ? (
        <Alert>
          <AlertTitle>Verify your email</AlertTitle>
          <AlertDescription>Check your inbox for the confirmation link we sent to {user.email}.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <CardDescription>What you can use right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-base font-semibold">
              {entitlements.lifetimeProducts.length > 0 ? "Lifetime Pro" : getPlan(entitlements.planKey).name}
            </p>
            <p className="text-muted-foreground">{entitlements.features.size} features unlocked</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/billing">Manage billing</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Billing details</CardTitle>
            <CardDescription>Printed on your GST invoices.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {billingProfile ? (
              <>
                <p className="font-medium">{billingProfile.legalName}</p>
                <p className="text-muted-foreground">
                  {billingProfile.city} · {billingProfile.gstin ? `GSTIN ${billingProfile.gstin}` : "No GSTIN (B2C)"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Add your billing address before you subscribe.</p>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/settings#billing">{billingProfile ? "Edit" : "Add billing details"}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
