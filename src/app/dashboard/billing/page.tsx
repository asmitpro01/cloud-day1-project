import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FEATURES, getPlan, isPlanKey, paidPlans, PRODUCTS } from "@/config/plans";
import { site } from "@/config/site";
import { formatDateIST } from "@/lib/dates";
import { formatINR, paise } from "@/lib/money";
import { getBillingProfile } from "@/server/account/billing-profile";
import { requireUser } from "@/server/auth/session";
import { getEntitlements } from "@/server/billing/entitlements";
import { getPaymentHistory } from "@/server/billing/history";
import { getCurrentSubscription } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db/client";
import { getPaymentProvider } from "@/server/providers/payments";
import { CancelSubscription } from "./_components/cancel-subscription";
import { CheckoutButton } from "./_components/checkout-button";
import { PlanPicker, type PlanOption } from "./_components/plan-picker";
import { PageSkeleton } from "../_components/page-skeleton";
import { StatusBadge } from "./_components/status-badge";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-muted-foreground">Plans, payments and GST invoices.</p>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <BillingContent />
      </Suspense>
    </div>
  );
}

async function BillingContent() {
  const user = await requireUser();
  const db = getDb();
  const provider = getPaymentProvider();
  const [billingProfile, subscription, history, entitlements] = await Promise.all([
    getBillingProfile(db, user.id),
    getCurrentSubscription(db, user.id),
    getPaymentHistory(db, user.id),
    getEntitlements(user.id),
  ]);
  const canCheckout = Boolean(provider && billingProfile);
  const themeColor = site.brand.colors.light.primary;

  const planOptions: PlanOption[] = paidPlans().map((plan) => ({
    key: plan.key,
    name: plan.name,
    description: plan.description,
    features: plan.features.map((feature) => FEATURES[feature]),
    highlighted: plan.highlighted ?? false,
    prices: {
      monthly: plan.prices.monthly ? formatINR(plan.prices.monthly, { showPaise: false }) : null,
      yearly: plan.prices.yearly ? formatINR(plan.prices.yearly, { showPaise: false }) : null,
    },
  }));

  const currentPlanName = subscription && isPlanKey(subscription.planKey) ? getPlan(subscription.planKey).name : null;
  const periodEnd = subscription?.currentPeriodEnd ? formatDateIST(subscription.currentPeriodEnd) : null;

  return (
    <div className="space-y-6">
      {provider?.mode === "test" ? <Badge variant="secondary">Test mode: no real money moves</Badge> : null}

      {!provider ? (
        <Alert>
          <AlertTitle>Payments are not configured</AlertTitle>
          <AlertDescription>Set PAYMENTS_PROVIDER and your Razorpay keys to start selling plans.</AlertDescription>
        </Alert>
      ) : !billingProfile ? (
        <Alert>
          <AlertTitle>Add your billing details first</AlertTitle>
          <AlertDescription>
            Your state decides the GST on your invoice.{" "}
            <Link href="/dashboard/settings#billing" className="underline">
              Add billing details
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            {subscription
              ? "Renews automatically until you cancel."
              : entitlements.lifetimeProducts.length
                ? "Lifetime access."
                : "You're on the Free plan."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {subscription ? (
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2 text-base font-semibold">
                {currentPlanName} · {formatINR(paise(subscription.amountPaise), { showPaise: false })}/
                {subscription.interval === "monthly" ? "month" : "year"} <StatusBadge status={subscription.status} />
              </p>
              {subscription.cancelAtPeriodEnd || subscription.status === "cancelled" ? (
                <p className="text-muted-foreground">
                  Ends on {periodEnd ?? "the end of this period"}. You won&apos;t be charged again.
                </p>
              ) : periodEnd ? (
                <p className="text-muted-foreground">Next charge on {periodEnd}</p>
              ) : null}
              {subscription.status === "pending" ? (
                <p className="text-destructive">
                  Your last payment failed. Razorpay will retry; update your payment method if it fails again.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm font-semibold">{entitlements.lifetimeProducts.length ? "Lifetime Pro" : "Free"}</p>
          )}
          {subscription && !subscription.cancelAtPeriodEnd && subscription.status !== "cancelled" ? (
            <CancelSubscription periodEnd={periodEnd} />
          ) : null}
        </CardContent>
      </Card>

      {provider ? (
        <Card>
          <CardHeader>
            <CardTitle>{subscription ? "Change plan" : "Choose a plan"}</CardTitle>
            <CardDescription>Pay with UPI AutoPay, cards or net banking. Cancel anytime.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlanPicker
              plans={planOptions}
              current={
                subscription && !subscription.cancelAtPeriodEnd
                  ? { planKey: subscription.planKey, interval: subscription.interval }
                  : null
              }
              canCheckout={canCheckout}
              themeColor={themeColor}
            />
          </CardContent>
        </Card>
      ) : null}

      {provider && PRODUCTS.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>One-time purchase</CardTitle>
            <CardDescription>Pay once, keep it forever.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {PRODUCTS.map((product) => (
              <div key={product.key} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">
                    {product.name} · {formatINR(product.price, { showPaise: false })}
                  </p>
                  <p className="text-sm text-muted-foreground">{product.description}</p>
                </div>
                <div className="sm:w-48">
                  {entitlements.lifetimeProducts.includes(product.key) ? (
                    <Badge>Owned</Badge>
                  ) : (
                    <CheckoutButton
                      request={{ kind: "order", productKey: product.key }}
                      label={`Buy ${product.name}`}
                      themeColor={themeColor}
                      variant="outline"
                      disabled={!canCheckout}
                    />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
          <CardDescription>Every charge, with its GST invoice.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDateIST(item.date)}</TableCell>
                    <TableCell>
                      {item.description}
                      {item.method ? (
                        <span className="text-muted-foreground"> · {item.method.toUpperCase()}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(item.amountPaise)}</TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      {item.invoice ? (
                        <a
                          href={`/api/invoices/${item.invoice.id}/pdf`}
                          className="text-sm text-primary underline underline-offset-4"
                        >
                          {item.invoice.number}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
