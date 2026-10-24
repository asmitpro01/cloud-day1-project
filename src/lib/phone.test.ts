import { describe, expect, it } from "vitest";
import { formatPhone, isValidE164, maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 9876543210", "+919876543210"],
    ["+1 415 555 2671", "+14155552671"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["12345", "5876543210", "+91 12345 67890", "+9198765432101", "abc", ""])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("isValidE164", () => {
  it("validates Indian mobiles strictly", () => {
    expect(isValidE164("+919876543210")).toBe(true);
    expect(isValidE164("+915876543210")).toBe(false);
    expect(isValidE164("919876543210")).toBe(false);
  });
});

describe("display helpers", () => {
  it("formats and masks", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(maskPhone("+919876543210")).toBe("+91 ••••• •3210");
    expect(formatPhone("+14155552671")).toBe("+14155552671");
  });
});
