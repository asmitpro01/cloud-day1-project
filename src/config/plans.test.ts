import { describe, expect, it } from "vitest";
import { FREE_PLAN_KEY, getPlan, getPlanPrice, isPlanKey, isProductKey, paidPlans } from "./plans";

describe("plan catalog", () => {
  it("has a free plan without prices", () => {
    expect(getPlan(FREE_PLAN_KEY).prices).toEqual({});
  });

  it("returns prices in paise and null for unsold intervals", () => {
    expect(getPlanPrice("pro", "monthly")).toBe(49900);
    expect(getPlanPrice("free", "monthly")).toBeNull();
  });

  it("lists only paid plans for checkout", () => {
    expect(paidPlans().map((plan) => plan.key)).toEqual(["pro", "business"]);
  });

  it("narrows keys", () => {
    expect(isPlanKey("pro")).toBe(true);
    expect(isPlanKey("lifetime")).toBe(false);
    expect(isProductKey("lifetime")).toBe(true);
  });
});
