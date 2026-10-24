import { describe, expect, it } from "vitest";
import { GST_STATES, getGstState, isGstStateCode, leviesUtgst } from "./states";

describe("GST states", () => {
  it("has unique two-digit codes", () => {
    const codes = GST_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^\d{2}$/);
  });

  it("excludes legacy codes", () => {
    expect(isGstStateCode("25")).toBe(false);
    expect(isGstStateCode("28")).toBe(false);
  });

  it("levies UTGST only in UTs without a legislature", () => {
    expect(leviesUtgst("04")).toBe(true); // Chandigarh
    expect(leviesUtgst("38")).toBe(true); // Ladakh
    expect(leviesUtgst("07")).toBe(false); // Delhi
    expect(leviesUtgst("34")).toBe(false); // Puducherry
    expect(leviesUtgst("01")).toBe(false); // Jammu and Kashmir
    expect(leviesUtgst("27")).toBe(false); // Maharashtra
  });

  it("looks up names", () => {
    expect(getGstState("29").name).toBe("Karnataka");
  });
});
