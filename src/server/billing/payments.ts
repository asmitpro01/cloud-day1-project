import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { payments } from "../db/schema";
import type { ProviderPayment } from "../providers/payments";
import type { PaymentStatus } from "../providers/payments/types";
import type { BillingFollowUp } from "./follow-ups";

export type PaymentRow = typeof payments.$inferSelect;

// A payment only moves forward: a late "failed" or "authorized" event never undoes a capture.
const STATUS_RANK: Record<PaymentStatus, number> = { created: 0, failed: 1, authorized: 2, captured: 3, refunded: 4 };

/**
 * Records a provider payment, keyed on its provider id, and returns the locked row.
 * Safe to call repeatedly from checkout verification and webhooks.
 */
export async function upsertPayment(
  tx: Tx,
  input: {
    provider: string;
    payment: ProviderPayment;
    userId: string | null;
    orderId: string | null;
    subscriptionId: string | null;
  },
): Promise<PaymentRow> {
  const { payment } = input;
  await tx
    .insert(payments)
    .values({
      provider: input.provider,
      providerPaymentId: payment.id,
      userId: input.userId,
      orderId: input.orderId,
      subscriptionId: input.subscriptionId,
      amountPaise: payment.amountPaise,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      errorCode: payment.errorCode,
      errorDescription: payment.errorDescription,
      capturedAt: payment.status === "captured" ? new Date() : null,
    })
    .onConflictDoNothing({ target: payments.providerPaymentId });

  const [current] = await tx.select().from(payments).where(eq(payments.providerPaymentId, payment.id)).for("update");
  if (!current) throw new Error(`Payment ${payment.id} missing after upsert`);

  const advance = STATUS_RANK[payment.status] > STATUS_RANK[current.status];
  const status = advance ? payment.status : current.status;
  const [updated] = await tx
    .update(payments)
    .set({
      status,
      userId: current.userId ?? input.userId,
      orderId: current.orderId ?? input.orderId,
      subscriptionId: current.subscriptionId ?? input.subscriptionId,
      method: current.method ?? payment.method,
      errorCode: status === "failed" ? payment.errorCode : current.errorCode,
      errorDescription: status === "failed" ? payment.errorDescription : current.errorDescription,
      capturedAt: status === "captured" ? (current.capturedAt ?? new Date()) : current.capturedAt,
    })
    .where(eq(payments.id, current.id))
    .returning();
  if (!updated) throw new Error(`Payment ${payment.id} could not be updated`);
  return updated;
}

/**
 * Runs once a payment is captured, inside the same transaction. Phase 4 issues the GST
 * invoice here; returns work to do after commit.
 */
export async function afterPaymentCaptured(_tx: Tx, _payment: PaymentRow): Promise<BillingFollowUp[]> {
  return [];
}
