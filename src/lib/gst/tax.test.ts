import { describe, expect, it } from "vitest";
import { paise } from "../money";
import { calculateGst, chargeAmountFor, formatRate, type GstBreakup } from "./tax";

const MAHARASHTRA = "27" as const;
const KARNATAKA = "29" as const;
const CHANDIGARH = "04" as const;
const LADAKH = "38" as const;
const DELHI = "07" as const;

function sumOfParts(result: GstBreakup): number {
  return result.taxablePaise + result.cgstPaise + result.sgstPaise + result.utgstPaise + result.igstPaise;
}

describe("calculateGst: place of supply", () => {
  it("charges CGST + SGST when seller and buyer are in the same state", () => {
    const result = calculateGst({
      amountPaise: paise(1_00_000),
      pricingMode: "exclusive",
      rateBps: 1800,
      sellerStateCode: MAHARASHTRA,
      placeOfSupplyStateCode: MAHARASHTRA,
    });
    expect(result).toEqual({
      supplyType: "intra-state",
      rateBps: 1800,
      taxablePaise: 1_00_000,
      cgstPaise: 9000,
      sgstPaise: 9000,
      utgstPaise: 0,
      igstPaise: 0,
      totalTaxPaise: 18_000,
      totalPaise: 1_18_000,
    });
  });

  it("charges IGST across states", () => {
    const result = calculateGst({
      amountPaise: paise(1_00_000),
      pricingMode: "exclusive",
      rateBps: 1800,
      sellerStateCode: MAHARASHTRA,
      placeOfSupplyStateCode: KARNATAKA,
    });
    expect(result).toMatchObject({
      supplyType: "inter-state",
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 18_000,
      totalPaise: 1_18_000,
    });
  });

  it("charges CGST + UTGST inside a UT without a legislature", () => {
    for (const ut of [CHANDIGARH, LADAKH]) {
      const result = calculateGst({
        amountPaise: paise(1_00_000),
        pricingMode: "exclusive",
        rateBps: 1800,
        sellerStateCode: ut,
        placeOfSupplyStateCode: ut,
      });
      expect(result).toMatchObject({ cgstPaise: 9000, sgstPaise: 0, utgstPaise: 9000, igstPaise: 0 });
    }
  });

  it("charges SGST in Delhi, a UT with a legislature", () => {
    const result = calculateGst({
      amountPaise: paise(1_00_000),
      pricingMode: "exclusive",
      rateBps: 1800,
      sellerStateCode: DELHI,
      placeOfSupplyStateCode: DELHI,
    });
    expect(result).toMatchObject({ sgstPaise: 9000, utgstPaise: 0 });
  });
});

describe("calculateGst: inclusive vs exclusive", () => {
  it("back-calculates ₹499 inclusive, inter-state", () => {
    const result = calculateGst({
      amountPaise: paise(49_900),
      pricingMode: "inclusive",
      rateBps: 1800,
      sellerStateCode: MAHARASHTRA,
      placeOfSupplyStateCode: KARNATAKA,
    });
    expect(result).toMatchObject({ taxablePaise: 42_288, igstPaise: 7612, totalPaise: 49_900 });
  });

  it("back-calculates ₹499 inclusive, intra-state with equal halves", () => {
    const result = calculateGst({
      amountPaise: paise(49_900),
      pricingMode: "inclusive",
      rateBps: 1800,
      sellerStateCode: MAHARASHTRA,
      placeOfSupplyStateCode: MAHARASHTRA,
    });
    expect(result).toMatchObject({ taxablePaise: 42_288, cgstPaise: 3806, sgstPaise: 3806, totalPaise: 49_900 });
  });

  it("adds GST on top in exclusive mode", () => {
    expect(chargeAmountFor(paise(49_900), "exclusive", 1800)).toBe(58_882);
    expect(chargeAmountFor(paise(49_900), "inclusive", 1800)).toBe(49_900);
  });

  it("keeps whole-rupee exclusive prices exact when re-derived from the charge", () => {
    const charged = chargeAmountFor(paise(49_900), "exclusive", 1800);
    for (const placeOfSupply of [MAHARASHTRA, KARNATAKA] as const) {
      const fromCharge = calculateGst({
        amountPaise: charged,
        pricingMode: "inclusive",
        rateBps: 1800,
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: placeOfSupply,
      });
      expect(fromCharge.taxablePaise).toBe(49_900);
      expect(fromCharge.totalPaise).toBe(charged);
    }
  });
});

describe("calculateGst: rounding to paise", () => {
  it("rounds each component half-up", () => {
    // 50 paise × 9% = 4.5 paise → 5 each.
    expect(
      calculateGst({
        amountPaise: paise(50),
        pricingMode: "exclusive",
        rateBps: 1800,
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
      }),
    ).toMatchObject({ cgstPaise: 5, sgstPaise: 5, totalPaise: 60 });
    // 50 paise × 18% = 9 paise exactly.
    expect(
      calculateGst({
        amountPaise: paise(50),
        pricingMode: "exclusive",
        rateBps: 1800,
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
      }),
    ).toMatchObject({ igstPaise: 9, totalPaise: 59 });
  });

  it("handles tiny and zero amounts", () => {
    expect(
      calculateGst({
        amountPaise: paise(1),
        pricingMode: "inclusive",
        rateBps: 1800,
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: MAHARASHTRA,
      }),
    ).toMatchObject({ taxablePaise: 1, cgstPaise: 0, totalPaise: 1 });
    expect(
      calculateGst({
        amountPaise: paise(0),
        pricingMode: "inclusive",
        rateBps: 1800,
        sellerStateCode: MAHARASHTRA,
        placeOfSupplyStateCode: KARNATAKA,
      }),
    ).toMatchObject({ taxablePaise: 0, igstPaise: 0, totalPaise: 0 });
  });

  it("always sums to the total, with equal halves and tax within a paisa of the exact rate", () => {
    for (const rateBps of [500, 1200, 1800, 2800, 25]) {
      for (let amount = 1; amount <= 20_000; amount += 7) {
        for (const pricingMode of ["inclusive", "exclusive"] as const) {
          for (const placeOfSupply of [MAHARASHTRA, KARNATAKA] as const) {
            const result = calculateGst({
              amountPaise: paise(amount),
              pricingMode,
              rateBps,
              sellerStateCode: MAHARASHTRA,
              placeOfSupplyStateCode: placeOfSupply,
            });
            expect(sumOfParts(result)).toBe(result.totalPaise);
            if (pricingMode === "inclusive") expect(result.totalPaise).toBe(amount);
            else expect(result.taxablePaise).toBe(amount);
            expect(result.cgstPaise).toBe(result.sgstPaise + result.utgstPaise);
            const exactTax = (result.taxablePaise * rateBps) / 10_000;
            expect(Math.abs(result.totalTaxPaise - exactTax)).toBeLessThanOrEqual(1.5);
          }
        }
      }
    }
  });

  it("rejects invalid input", () => {
    const base = { pricingMode: "inclusive" as const, sellerStateCode: MAHARASHTRA, placeOfSupplyStateCode: KARNATAKA };
    expect(() => calculateGst({ ...base, amountPaise: paise(-1), rateBps: 1800 })).toThrow(RangeError);
    expect(() => calculateGst({ ...base, amountPaise: paise(100), rateBps: 18.5 })).toThrow(RangeError);
  });
});

describe("formatRate", () => {
  it("formats basis points as percentages", () => {
    expect(formatRate(1800)).toBe("18%");
    expect(formatRate(900)).toBe("9%");
    expect(formatRate(25)).toBe("0.25%");
    expect(formatRate(1250)).toBe("12.5%");
    expect(formatRate(12.5)).toBe("0.125%");
  });
});
