import "server-only";
import { and, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { getDb } from "../db/client";
import { invoices, subscriptions, user, waitlistEntries } from "../db/schema";

export const ADMIN_PAGE_SIZE = 25;

export type Page<T> = { rows: T[]; total: number; page: number; pageCount: number };

function pageOffset(page: number): number {
  return (Math.max(1, page) - 1) * ADMIN_PAGE_SIZE;
}

function toPage<T>(rows: T[], total: number, page: number): Page<T> {
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

/** Escapes LIKE wildcards in user-typed search text. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export async function listUsers(options: { page: number; query?: string }) {
  const db = getDb();
  const where: SQL | undefined = options.query
    ? or(
        ilike(user.email, likePattern(options.query)),
        ilike(user.name, likePattern(options.query)),
        ilike(user.phoneNumber, likePattern(options.query)),
      )
    : undefined;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(pageOffset(options.page)),
    db.select({ total: count() }).from(user).where(where),
  ]);

  const ids = rows.map((row) => row.id);
  const plans = ids.length
    ? await db
        .select({ userId: subscriptions.userId, planKey: subscriptions.planKey, status: subscriptions.status })
        .from(subscriptions)
        .where(
          and(
            inArray(subscriptions.userId, ids),
            inArray(subscriptions.status, ["active", "pending", "halted", "paused"]),
          ),
        )
    : [];
  const planByUser = new Map(plans.map((plan) => [plan.userId, plan]));

  return toPage(
    rows.map((row) => ({ ...row, subscription: planByUser.get(row.id) ?? null })),
    totals?.total ?? 0,
    options.page,
  );
}

export async function listSubscriptions(options: { page: number }) {
  const db = getDb();
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: subscriptions.id,
        email: user.email,
        name: user.name,
        planKey: subscriptions.planKey,
        interval: subscriptions.interval,
        amountPaise: subscriptions.amountPaise,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        providerSubscriptionId: subscriptions.providerSubscriptionId,
        createdAt: subscriptions.createdAt,
      })
      .from(subscriptions)
      .leftJoin(user, eq(user.id, subscriptions.userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(pageOffset(options.page)),
    db.select({ total: count() }).from(subscriptions),
  ]);
  return toPage(rows, totals?.total ?? 0, options.page);
}

export async function listInvoices(options: { page: number }) {
  const db = getDb();
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.invoiceDate,
        buyer: invoices.buyer,
        placeOfSupplyStateCode: invoices.placeOfSupplyStateCode,
        supplyType: invoices.supplyType,
        taxablePaise: invoices.taxablePaise,
        totalTaxPaise: invoices.totalTaxPaise,
        totalPaise: invoices.totalPaise,
        emailedAt: invoices.emailedAt,
      })
      .from(invoices)
      .orderBy(desc(invoices.issuedAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(pageOffset(options.page)),
    db.select({ total: count() }).from(invoices),
  ]);
  return toPage(rows, totals?.total ?? 0, options.page);
}

export async function listWaitlist(options: { page: number }) {
  const db = getDb();
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(waitlistEntries)
      .orderBy(desc(waitlistEntries.createdAt))
      .limit(ADMIN_PAGE_SIZE)
      .offset(pageOffset(options.page)),
    db.select({ total: count() }).from(waitlistEntries),
  ]);
  return toPage(rows, totals?.total ?? 0, options.page);
}

/** Every waitlist entry, oldest first, for the CSV export. */
export async function allWaitlistEntries() {
  return getDb().select().from(waitlistEntries).orderBy(waitlistEntries.createdAt);
}
