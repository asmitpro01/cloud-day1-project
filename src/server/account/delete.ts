import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { user } from "../db/schema";
import { logger } from "../logger";

/**
 * Erases a user (DPDP right to erasure). Sessions, linked accounts, consents and the billing
 * profile cascade; invoices and payments keep their snapshot with `user_id` set to null because
 * the CGST Act requires keeping tax records.
 */
export async function deleteAccount(userId: string): Promise<void> {
  await getDb().delete(user).where(eq(user.id, userId));
  logger.info("Account deleted", { userId });
}
