import { splitPaise, type Paise } from "./money";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
] as const;

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"] as const;

function below100(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const tens = TENS[Math.floor(n / 10)] ?? "";
  const ones = ONES[n % 10] ?? "";
  return ones ? `${tens} ${ones}` : tens;
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds] ?? ""} Hundred`);
  if (rest) parts.push(below100(rest));
  return parts.join(" ");
}

/**
 * Spells a non-negative integer using the Indian numbering system
 * (thousand, lakh, crore): `12345678` → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight".
 * Amounts of 100 crore or more repeat the scale: "One Hundred Crore".
 */
export function integerToIndianWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Expected a non-negative integer, got ${value}`);
  }
  if (value === 0) return "Zero";

  const crore = Math.floor(value / 10_000_000);
  const lakh = Math.floor((value % 10_000_000) / 100_000);
  const thousand = Math.floor((value % 100_000) / 1000);
  const rest = value % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/**
 * Spells a rupee amount the way Indian invoices print it:
 * `12345650` → "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only".
 */
export function amountInWords(amount: Paise): string {
  const { negative, rupees, paise } = splitPaise(amount);
  const prefix = negative ? "Minus " : "";

  if (rupees === 0 && paise > 0) {
    return `${prefix}${below100(paise)} Paise Only`;
  }
  const paisePart = paise > 0 ? ` and ${below100(paise)} Paise` : "";
  return `${prefix}Rupees ${integerToIndianWords(rupees)}${paisePart} Only`;
}
