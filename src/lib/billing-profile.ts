import { z } from "zod";
import { checkGstin, GSTIN_ERROR_MESSAGES, normalizeGstin } from "./gst/gstin";
import { getGstState, gstStateCodeSchema } from "./gst/states";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

/**
 * Billing details printed on GST invoices. When a GSTIN is given, its state prefix must
 * match the billing state, because place of supply follows the registered location.
 */
export const billingProfileSchema = z
  .object({
    legalName: z.string().trim().min(2, "Enter the name to print on invoices").max(200),
    gstin: z.preprocess(blankToUndefined, z.string().transform(normalizeGstin).optional()),
    addressLine1: z.string().trim().min(3, "Enter your street address").max(200),
    addressLine2: z.preprocess(blankToUndefined, z.string().trim().max(200).optional()),
    city: z.string().trim().min(2, "Enter your city").max(100),
    stateCode: gstStateCodeSchema,
    pincode: z
      .string()
      .trim()
      .regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code"),
  })
  .superRefine((value, ctx) => {
    if (!value.gstin) return;
    const gstin = checkGstin(value.gstin);
    if (!gstin.valid) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: GSTIN_ERROR_MESSAGES[gstin.reason] });
    } else if (gstin.stateCode !== value.stateCode) {
      ctx.addIssue({
        code: "custom",
        path: ["stateCode"],
        message: `This GSTIN is registered in ${getGstState(gstin.stateCode).name}. Choose that state.`,
      });
    }
  });

export type BillingProfileInput = z.infer<typeof billingProfileSchema>;
