import { describe, expect, it } from "vitest";
import { amountInWords, integerToIndianWords } from "./amount-in-words";
import { paise } from "./money";

describe("integerToIndianWords", () => {
  it.each([
    [0, "Zero"],
    [7, "Seven"],
    [19, "Nineteen"],
    [40, "Forty"],
    [99, "Ninety Nine"],
    [100, "One Hundred"],
    [101, "One Hundred One"],
    [1000, "One Thousand"],
    [99_999, "Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [1_00_000, "One Lakh"],
    [12_34_567, "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven"],
    [1_00_00_000, "One Crore"],
    [1_23_45_678, "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight"],
    [100_00_00_000, "One Hundred Crore"],
    [
      1234_56_78_901,
      "One Thousand Two Hundred Thirty Four Crore Fifty Six Lakh Seventy Eight Thousand Nine Hundred One",
    ],
  ])("%i → %s", (value, words) => {
    expect(integerToIndianWords(value)).toBe(words);
  });

  it("rejects negatives and fractions", () => {
    expect(() => integerToIndianWords(-1)).toThrow(RangeError);
    expect(() => integerToIndianWords(1.5)).toThrow(RangeError);
  });
});

describe("amountInWords", () => {
  it("spells rupees and paise", () => {
    expect(amountInWords(paise(12345650))).toBe(
      "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only",
    );
    expect(amountInWords(paise(58882))).toBe("Rupees Five Hundred Eighty Eight and Eighty Two Paise Only");
    expect(amountInWords(paise(100))).toBe("Rupees One Only");
  });

  it("handles paise-only and zero amounts", () => {
    expect(amountInWords(paise(5))).toBe("Five Paise Only");
    expect(amountInWords(paise(0))).toBe("Rupees Zero Only");
  });

  it("handles negative amounts (credit notes)", () => {
    expect(amountInWords(paise(-100))).toBe("Minus Rupees One Only");
  });
});
