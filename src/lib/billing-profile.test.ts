import { describe, expect, it } from "vitest";
import { billingProfileSchema } from "./billing-profile";

const valid = {
  legalName: "Acme Pvt Ltd",
  gstin: "",
  addressLine1: "12 MG Road",
  addressLine2: "",
  city: "Bengaluru",
  stateCode: "29",
  pincode: "560001",
};

describe("billingProfileSchema", () => {
  it("accepts a B2C profile without GSTIN", () => {
    const result = billingProfileSchema.parse(valid);
    expect(result.gstin).toBeUndefined();
    expect(result.addressLine2).toBeUndefined();
  });

  it("normalises and accepts a GSTIN that matches the state", () => {
    const result = billingProfileSchema.parse({ ...valid, gstin: "29aagcb7383j1z4", stateCode: "29" });
    expect(result.gstin).toBe("29AAGCB7383J1Z4");
  });

  it("rejects a GSTIN from another state", () => {
    const result = billingProfileSchema.safeParse({ ...valid, gstin: "27AAPFU0939F1ZV" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["stateCode"]);
    expect(result.error?.issues[0]?.message).toContain("Maharashtra");
  });

  it("rejects bad checksums, states and PIN codes", () => {
    expect(billingProfileSchema.safeParse({ ...valid, gstin: "29AAGCB7383J1Z5" }).success).toBe(false);
    expect(billingProfileSchema.safeParse({ ...valid, stateCode: "28" }).success).toBe(false);
    expect(billingProfileSchema.safeParse({ ...valid, pincode: "060001" }).success).toBe(false);
  });
});
