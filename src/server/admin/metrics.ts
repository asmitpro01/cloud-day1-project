import "server-only";
import { and, count, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { site } from "@/config/site";
import { startOfIstMonth } from "@/lib/dates";
import { divideRoundHalfUp, paise, paiseFromBigInt, type Paise } from "@/lib/money";
import { getDb } from "../db/client";
import { payments, subscriptions, user, waitlistEntries } from "../db/schema";

export type AdminMetrics = {
  /** Monthly recurring revenue excluding GST (GST collected isn't revenue). */
  mrrPaise: Paise;
  mrrIncludingGstPaise: Paise;
  activeSubscriptions: number;
  atRiskSubscriptions: number;
  churnedThisMonth: number;
  /** Churned this month ÷ active at the start of the month, in basis points. */
  churnRateBps: number;
  revenueThisMonthPaise: Paise;
  totalUsers: number;
  waitlistCount: number;
};

const integer = z.coerce.number().int();
const ACTIVE = ["active", "pending"] as const;
const ENDED = ["cancelled", "halted", "completed", "expired"] as const;

/** Dashboard numbers for /admin. "This month" is the current calendar month in IST. */
export async function getAdminMetrics(now = new Date()): Promise<AdminMetrics> {
  const db = getDb();
  const monthStart = startOfIstMonth(now);
  const rate = site.gst.rateBps;
  // Raw SQL has no column type to map a Date parameter, so compare against an explicit timestamptz.
  const endedThisMonth = sql`coalesce(${subscriptions.endedAt}, ${subscriptions.cancelledAt}, ${subscriptions.updatedAt}) >= ${monthStart.toISOString()}::timestamptz`;

  const [mrrRow, riskRow, churnRow, baseRow, revenueRow, usersRow, waitlistRow] = await Promise.all([
    // Yearly plans count as a twelfth per month. numeric arithmetic keeps this exact (no floats).
    db
      .select({
        gross: sql<string>`coalesce(sum(case when ${subscriptions.interval} = 'yearly' then round(${subscriptions.amountPaise}::numeric / 12) else ${subscriptions.amountPaise} end), 0)::bigint`,
        count: count(),
      })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ACTIVE)),
    db
      .select({ count: count() })
      .from(subscriptions)
      .where(inArray(subscriptions.status, ["pending", "halted"])),
    db
      .select({ count: count() })
      .from(subscriptions)
      .where(and(inArray(subscriptions.status, ENDED), endedThisMonth)),
    db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          lt(subscriptions.createdAt, monthStart),
          isNotNull(subscriptions.currentPeriodStart),
          or(inArray(subscriptions.status, ACTIVE), and(inArray(subscriptions.status, ENDED), endedThisMonth)),
        ),
      ),
    db
      .select({ total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::bigint` })
      .from(payments)
      .where(and(sql`${payments.status} in ('captured', 'refunded')`, gte(payments.capturedAt, monthStart))),
    db.select({ count: count() }).from(user),
    db.select({ count: count() }).from(waitlistEntries),
  ]);

  const mrrGross = integer.parse(mrrRow[0]?.gross ?? 0);
  const churned = integer.parse(churnRow[0]?.count ?? 0);
  const base = integer.parse(baseRow[0]?.count ?? 0);
  // Net of GST: back out the tax that the charged amounts contain.
  const mrrNet = paiseFromBigInt(divideRoundHalfUp(BigInt(mrrGross) * 10_000n, BigInt(10_000 + rate)));

  return {
    mrrPaise: mrrNet,
    mrrIncludingGstPaise: paise(mrrGross),
    activeSubscriptions: integer.parse(mrrRow[0]?.count ?? 0),
    atRiskSubscriptions: integer.parse(riskRow[0]?.count ?? 0),
    churnedThisMonth: churned,
    churnRateBps: base === 0 ? 0 : Math.round((churned * 10_000) / base),
    revenueThisMonthPaise: paise(integer.parse(revenueRow[0]?.total ?? 0)),
    totalUsers: integer.parse(usersRow[0]?.count ?? 0),
    waitlistCount: integer.parse(waitlistRow[0]?.count ?? 0),
  };
}
