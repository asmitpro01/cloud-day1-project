import { describe, expect, it } from "vitest";
import { divideRoundHalfUp, formatINR, paise, rupees, splitPaise, sumPaise } from "./money";

describe("paise", () => {
  it("accepts integers and rejects floats", () => {
    expect(paise(49900)).toBe(49900);
    expect(() => paise(499.5)).toThrow(RangeError);
    expect(() => paise(Number.NaN)).toThrow(RangeError);
  });

  it("builds amounts from rupees", () => {
    expect(rupees(499)).toBe(49900);
    expect(rupees(1, 5)).toBe(105);
    expect(() => rupees(1.5)).toThrow(RangeError);
    expect(() => rupees(1, 100)).toThrow(RangeError);
  });

  it("sums amounts", () => {
    expect(sumPaise(paise(100), paise(250), paise(-50))).toBe(300);
  });

  it("splits without float division", () => {
    expect(splitPaise(paise(Number.MAX_SAFE_INTEGER))).toEqual({
      negative: false,
      rupees: 90071992547409,
      paise: 91,
    });
  });
});

describe("formatINR", () => {
  it("uses lakh/crore grouping", () => {
    expect(formatINR(paise(12345600))).toBe("₹1,23,456.00");
    expect(formatINR(paise(1234567890))).toBe("₹1,23,45,678.90");
    expect(formatINR(paise(99))).toBe("₹0.99");
    expect(formatINR(paise(0))).toBe("₹0.00");
  });

  it("handles negatives and options", () => {
    expect(formatINR(paise(-50050))).toBe("-₹500.50");
    expect(formatINR(paise(499900), { showPaise: false })).toBe("₹4,999");
    expect(formatINR(paise(100000), { showSymbol: false })).toBe("1,000.00");
  });

  it("formats the largest safe amount exactly", () => {
    expect(formatINR(paise(Number.MAX_SAFE_INTEGER))).toBe("₹9,00,71,99,25,47,409.91");
  });
});

describe("divideRoundHalfUp", () => {
  it("rounds half away from zero", () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(7n, 4n)).toBe(2n);
    expect(divideRoundHalfUp(5n, 4n)).toBe(1n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(0n, 7n)).toBe(0n);
  });

  it("rejects division by zero", () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});
