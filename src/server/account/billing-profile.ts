import "server-only";
import { eq } from "drizzle-orm";
import type { BillingProfileInput } from "@/lib/billing-profile";
import { isGstStateCode, type GstStateCode } from "@/lib/gst/states";
import type { DbOrTx } from "../db/client";
import { billingProfiles } from "../db/schema";

export type BillingProfile = {
  legalName: string;
  gstin: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateCode: GstStateCode;
  pincode: string;
};

export async function getBillingProfile(db: DbOrTx, userId: string): Promise<BillingProfile | null> {
  const [row] = await db.select().from(billingProfiles).where(eq(billingProfiles.userId, userId)).limit(1);
  if (!row || !isGstStateCode(row.stateCode)) return null;
  return {
    legalName: row.legalName,
    gstin: row.gstin,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    stateCode: row.stateCode,
    pincode: row.pincode,
  };
}

export async function saveBillingProfile(db: DbOrTx, userId: string, input: BillingProfileInput): Promise<void> {
  const values = {
    legalName: input.legalName,
    gstin: input.gstin ?? null,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    stateCode: input.stateCode,
    pincode: input.pincode,
  };
  await db
    .insert(billingProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: billingProfiles.userId, set: values });
}
