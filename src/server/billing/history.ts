import "server-only";
import { desc, eq } from "drizzle-orm";
import { getPlan, getProduct, isPlanKey, isProductKey } from "@/config/plans";
import { paise, type Paise } from "@/lib/money";
import type { DbOrTx } from "../db/client";
import { invoices, orders, payments, subscriptions } from "../db/schema";

export type PaymentHistoryItem = {
  id: string;
  date: Date;
  description: string;
  amountPaise: Paise;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  method: string | null;
  invoice: { id: string; number: string } | null;
};

/** The user's payments, newest first, with a human description. */
export async function getPaymentHistory(db: DbOrTx, userId: string, limit = 50): Promise<PaymentHistoryItem[]> {
  const rows = await db
    .select({
      id: payments.id,
      createdAt: payments.createdAt,
      amountPaise: payments.amountPaise,
      status: payments.status,
      method: payments.method,
      planKey: subscriptions.planKey,
      interval: subscriptions.interval,
      productKey: orders.productKey,
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(payments)
    .leftJoin(subscriptions, eq(subscriptions.id, payments.subscriptionId))
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .leftJoin(invoices, eq(invoices.paymentId, payments.id))
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt))
    .limit(limit);

  return rows.map((row) => {
    let description = "Payment";
    if (row.planKey && isPlanKey(row.planKey)) description = `${getPlan(row.planKey).name} plan (${row.interval})`;
    else if (row.productKey && isProductKey(row.productKey)) description = getProduct(row.productKey).name;
    return {
      id: row.id,
      date: row.createdAt,
      description,
      amountPaise: paise(row.amountPaise),
      status: row.status,
      method: row.method,
      invoice: row.invoiceId && row.invoiceNumber ? { id: row.invoiceId, number: row.invoiceNumber } : null,
    };
  });
}
