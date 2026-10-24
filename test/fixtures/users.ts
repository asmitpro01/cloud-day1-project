import { randomUUID } from "node:crypto";
import type { CurrentUser } from "@/server/auth/session";
import { saveBillingProfile } from "@/server/account/billing-profile";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

/** Inserts a user (and optionally a billing profile) directly, bypassing auth hooks. */
export async function createTestUser(
  options: { stateCode?: "27" | "29" | "04"; gstin?: string; billing?: boolean } = {},
): Promise<CurrentUser> {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await getDb().insert(user).values({ id, name: "Test User", email, emailVerified: true });
  if (options.billing !== false) {
    await saveBillingProfile(getDb(), id, {
      legalName: "Test User",
      gstin: options.gstin,
      addressLine1: "1 Test Street",
      addressLine2: undefined,
      city: "Test City",
      stateCode: options.stateCode ?? "29",
      pincode: "560001",
    });
  }
  return { id, name: "Test User", email, emailVerified: true, hasRealEmail: true, phoneNumber: null, isAdmin: false };
}
