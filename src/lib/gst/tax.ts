import { divideRoundHalfUp, paiseFromBigInt, type Paise } from "../money";
import { leviesUtgst, type GstStateCode } from "./states";

export type PricingMode = "inclusive" | "exclusive";
export type SupplyType = "intra-state" | "inter-state";

export type GstInput = {
  /** Inclusive mode: the total charged. Exclusive mode: the taxable value before GST. */
  amountPaise: Paise;
  pricingMode: PricingMode;
  /** Total GST rate in basis points: 1800 = 18%. Intra-state supplies split it in half. */
  rateBps: number;
  sellerStateCode: GstStateCode;
  placeOfSupplyStateCode: GstStateCode;
};

export type GstBreakup = {
  supplyType: SupplyType;
  rateBps: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  /** SGST for states and UTs with a legislature. */
  sgstPaise: Paise;
  /** UTGST replaces SGST in UTs without a legislature (UTGST Act, 2017). */
  utgstPaise: Paise;
  igstPaise: Paise;
  totalTaxPaise: Paise;
  totalPaise: Paise;
};

const BPS = 10_000n;

/**
 * Splits an amount into taxable value and GST.
 *
 * - Same state (seller = place of supply): CGST + SGST, or CGST + UTGST in UTs without a
 *   legislature, each at half the rate. Different states: IGST at the full rate (IGST Act s.5).
 * - Each tax component is rounded half-up to the paise. Intra-state halves are always equal.
 * - Inclusive mode keeps the total fixed and back-calculates the taxable value; any rounding
 *   difference is absorbed by the taxable value, so the components always sum to the total.
 */
export function calculateGst(input: GstInput): GstBreakup {
  const { amountPaise, pricingMode, rateBps, sellerStateCode, placeOfSupplyStateCode } = input;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new RangeError("Amount must be non-negative paise");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) throw new RangeError("Rate must be 0–10000 bps");

  const amount = BigInt(amountPaise);
  const rate = BigInt(rateBps);
  const intraState = sellerStateCode === placeOfSupplyStateCode;

  let taxable: bigint;
  let half = 0n;
  let igst = 0n;

  if (pricingMode === "exclusive") {
    taxable = amount;
    if (intraState) half = divideRoundHalfUp(taxable * rate, BPS * 2n);
    else igst = divideRoundHalfUp(taxable * rate, BPS);
  } else {
    const estimatedTaxable = divideRoundHalfUp(amount * BPS, BPS + rate);
    if (intraState) {
      half = divideRoundHalfUp(estimatedTaxable * rate, BPS * 2n);
      taxable = amount - half * 2n;
    } else {
      taxable = estimatedTaxable;
      igst = amount - taxable;
    }
  }

  const utgst = intraState && leviesUtgst(placeOfSupplyStateCode);
  const totalTax = half * 2n + igst;
  return {
    supplyType: intraState ? "intra-state" : "inter-state",
    rateBps,
    taxablePaise: paiseFromBigInt(taxable),
    cgstPaise: paiseFromBigInt(half),
    sgstPaise: paiseFromBigInt(utgst ? 0n : half),
    utgstPaise: paiseFromBigInt(utgst ? half : 0n),
    igstPaise: paiseFromBigInt(igst),
    totalTaxPaise: paiseFromBigInt(totalTax),
    totalPaise: paiseFromBigInt(taxable + totalTax),
  };
}

/** The amount to charge for a list price: unchanged when inclusive, price + GST (at the full rate) when exclusive. */
export function chargeAmountFor(pricePaise: Paise, pricingMode: PricingMode, rateBps: number): Paise {
  if (pricingMode === "inclusive") return pricePaise;
  return paiseFromBigInt(BigInt(pricePaise) + divideRoundHalfUp(BigInt(pricePaise) * BigInt(rateBps), BPS));
}

/** `1800` → `"18%"`, `900` → `"9%"`, `25` → `"0.25%"`, `12.5` (half of 25) → `"0.125%"`. Display only. */
export function formatRate(rateBps: number): string {
  return `${Number((rateBps / 100).toFixed(3))}%`;
}
