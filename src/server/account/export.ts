import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { account, invoices, orders, payments, session, subscriptions, user, userConsents } from "../db/schema";
import { getBillingProfile } from "./billing-profile";

/**
 * Everything we hold about a user, for the DPDP right to access. Secrets (password hashes,
 * OAuth tokens, session tokens) are deliberately excluded.
 */
export async function buildDataExport(userId: string): Promise<Record<string, unknown>> {
  const db = getDb();
  const [profile] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      phoneNumber: user.phoneNumber,
      phoneNumberVerified: user.phoneNumberVerified,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId));

  const [
    billingProfile,
    consents,
    sessions,
    linkedAccounts,
    userSubscriptions,
    userOrders,
    userPayments,
    userInvoices,
  ] = await Promise.all([
    getBillingProfile(db, userId),
    db
      .select({
        purpose: userConsents.purpose,
        policyVersion: userConsents.policyVersion,
        grantedAt: userConsents.grantedAt,
        ipAddress: userConsents.ipAddress,
        withdrawnAt: userConsents.withdrawnAt,
      })
      .from(userConsents)
      .where(eq(userConsents.userId, userId)),
    db
      .select({
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(eq(session.userId, userId))
      .orderBy(desc(session.createdAt)),
    db
      .select({ provider: account.providerId, createdAt: account.createdAt })
      .from(account)
      .where(eq(account.userId, userId)),
    db
      .select({
        planKey: subscriptions.planKey,
        interval: subscriptions.interval,
        amountPaise: subscriptions.amountPaise,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId)),
    db
      .select({
        productKey: orders.productKey,
        amountPaise: orders.amountPaise,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.userId, userId)),
    db
      .select({
        amountPaise: payments.amountPaise,
        status: payments.status,
        method: payments.method,
        providerPaymentId: payments.providerPaymentId,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.userId, userId)),
    db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        buyer: invoices.buyer,
        placeOfSupplyStateCode: invoices.placeOfSupplyStateCode,
        taxablePaise: invoices.taxablePaise,
        totalTaxPaise: invoices.totalTaxPaise,
        totalPaise: invoices.totalPaise,
      })
      .from(invoices)
      .where(eq(invoices.userId, userId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile,
    billingProfile,
    consents,
    sessions,
    linkedAccounts,
    subscriptions: userSubscriptions,
    orders: userOrders,
    payments: userPayments,
    invoices: userInvoices,
  };
}
