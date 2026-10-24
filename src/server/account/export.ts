import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { account, session, user, userConsents } from "../db/schema";
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

  const [billingProfile, consents, sessions, linkedAccounts] = await Promise.all([
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
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile,
    billingProfile,
    consents,
    sessions,
    linkedAccounts,
  };
}
