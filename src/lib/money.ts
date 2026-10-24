/**
 * Money is always an integer number of paise (1 rupee = 100 paise).
 *
 * `Paise` is a branded number so a rupee amount, a float or a count can't be
 * passed where money is expected. Create values with `paise()` or `rupees()`.
 */
export type Paise = number & { readonly __brand: "Paise" };

/** True when `value` is a safe integer, i.e. a valid paise amount. */
export function isPaise(value: number): value is Paise {
  return Number.isSafeInteger(value);
}

/** Wraps an integer paise amount. Throws on floats, NaN or unsafe integers. */
export function paise(value: number): Paise {
  if (!isPaise(value)) {
    throw new RangeError(`Expected an integer number of paise, got ${value}`);
  }
  return value;
}

/** Builds a paise amount from whole rupees plus optional paise: `rupees(499)` is ₹499.00. */
export function rupees(wholeRupees: number, extraPaise = 0): Paise {
  if (!Number.isSafeInteger(wholeRupees) || !Number.isInteger(extraPaise)) {
    throw new RangeError("rupees() takes integers only; use paise() for exact amounts");
  }
  if (extraPaise < 0 || extraPaise > 99) {
    throw new RangeError("extraPaise must be between 0 and 99");
  }
  const sign = wholeRupees < 0 ? -1 : 1;
  return paise(wholeRupees * 100 + sign * extraPaise);
}

/** Adds paise amounts. */
export function sumPaise(...amounts: Paise[]): Paise {
  return paise(amounts.reduce<number>((total, amount) => total + amount, 0));
}

/** Splits an amount into whole rupees and remaining paise without float division. */
export function splitPaise(amount: Paise): { negative: boolean; rupees: number; paise: number } {
  const abs = Math.abs(amount);
  const remainder = abs % 100;
  return { negative: amount < 0, rupees: (abs - remainder) / 100, paise: remainder };
}

const INR_GROUPING = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export type FormatINROptions = {
  /** Show the paise part (".00"). Default true. */
  showPaise?: boolean;
  /** Prefix with the ₹ symbol. Default true. */
  showSymbol?: boolean;
};

/**
 * Formats paise as Indian rupees with lakh/crore grouping: `12345600` → `₹1,23,456.00`.
 * Uses integer arithmetic only, so large amounts never pick up float rounding errors.
 */
export function formatINR(amount: Paise, options: FormatINROptions = {}): string {
  const { showPaise = true, showSymbol = true } = options;
  const parts = splitPaise(amount);
  const grouped = INR_GROUPING.format(parts.rupees);
  const fraction = showPaise ? `.${String(parts.paise).padStart(2, "0")}` : "";
  return `${parts.negative ? "-" : ""}${showSymbol ? "₹" : ""}${grouped}${fraction}`;
}

/** Rounds `numerator / denominator` half-up (away from zero on .5) using BigInt. Both must be integers. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new RangeError("Division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (n * 2n + d) / (d * 2n);
  return negative ? -quotient : quotient;
}

/** Converts a BigInt produced by money math back to `Paise`, checking it is still safe. */
export function paiseFromBigInt(value: bigint): Paise {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("Amount exceeds the safe integer range");
  }
  return paise(Number(value));
}
