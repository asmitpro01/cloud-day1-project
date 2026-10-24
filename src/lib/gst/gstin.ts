import { isGstStateCode, type GstStateCode } from "./states";

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// 2-digit state code, 10-char PAN, entity number (1-9, A-Z), "Z", check character.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Computes the GSTIN check character (15th position) for the first 14 characters,
 * using the mod-36 weighted algorithm published by GSTN.
 */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14.charAt(i));
    if (value < 0) throw new RangeError(`Invalid GSTIN character at position ${i + 1}`);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET.charAt((36 - (sum % 36)) % 36);
}

/** Uppercases and strips spaces so users can paste `27aapfu 0939f1zv`. */
export function normalizeGstin(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

export type GstinCheck =
  | { valid: true; stateCode: GstStateCode; pan: string }
  | { valid: false; reason: "format" | "state-code" | "checksum" };

/** Validates a normalised GSTIN's format, state code and check character. */
export function checkGstin(gstin: string): GstinCheck {
  if (!GSTIN_PATTERN.test(gstin)) return { valid: false, reason: "format" };
  const stateCode = gstin.slice(0, 2);
  if (!isGstStateCode(stateCode)) return { valid: false, reason: "state-code" };
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin.charAt(14)) {
    return { valid: false, reason: "checksum" };
  }
  return { valid: true, stateCode, pan: gstin.slice(2, 12) };
}

export function isValidGstin(gstin: string): boolean {
  return checkGstin(gstin).valid;
}

export const GSTIN_ERROR_MESSAGES: Record<"format" | "state-code" | "checksum", string> = {
  format: "GSTIN must be 15 characters, like 27AAPFU0939F1ZV",
  "state-code": "GSTIN starts with an unknown state code",
  checksum: "GSTIN check digit doesn't match. Please re-check for typos",
};
