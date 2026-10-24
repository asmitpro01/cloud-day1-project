import { describe, expect, it } from "vitest";
import { checkGstin, gstinCheckCharacter, isValidGstin, normalizeGstin } from "./gstin";

describe("GSTIN validation", () => {
  it.each(["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "07AAACB2894G1ZP"])("accepts %s", (gstin) => {
    expect(isValidGstin(gstin)).toBe(true);
  });

  it("computes the check character", () => {
    expect(gstinCheckCharacter("27AAPFU0939F1Z")).toBe("V");
  });

  it("explains why a GSTIN is invalid", () => {
    expect(checkGstin("27AAPFU0939F1ZX")).toEqual({ valid: false, reason: "checksum" });
    expect(checkGstin("27AAPFU0939F1Z")).toEqual({ valid: false, reason: "format" });
    expect(checkGstin("99AAPFU0939F1ZV")).toEqual({ valid: false, reason: "state-code" });
    expect(checkGstin("27aapfu0939f1zv")).toEqual({ valid: false, reason: "format" });
  });

  it("returns the state code and PAN", () => {
    expect(checkGstin("27AAPFU0939F1ZV")).toEqual({ valid: true, stateCode: "27", pan: "AAPFU0939F" });
  });

  it("normalises pasted input", () => {
    expect(normalizeGstin(" 27aapfu 0939f1zv ")).toBe("27AAPFU0939F1ZV");
  });
});
