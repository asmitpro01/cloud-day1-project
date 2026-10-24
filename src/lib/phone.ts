/** A phone number in E.164 form, e.g. `+919876543210`. */
export type E164 = string & { readonly __brand: "E164" };

export const DEFAULT_COUNTRY_CODE = "91";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
// Indian mobile numbers are 10 digits starting with 6, 7, 8 or 9.
const INDIAN_MOBILE_PATTERN = /^\+91[6-9]\d{9}$/;

/** True for a valid E.164 number. Numbers with +91 must also be valid Indian mobiles. */
export function isValidE164(value: string): value is E164 {
  if (!E164_PATTERN.test(value)) return false;
  if (value.startsWith("+91")) return INDIAN_MOBILE_PATTERN.test(value);
  return true;
}

/**
 * Normalises user input to E.164, assuming +91 when no country code is given.
 * Accepts `98765 43210`, `098765-43210`, `+91 98765 43210`, `0091…` and `91…` (12 digits).
 * Returns `null` when the result is not a valid number.
 */
export function normalizePhone(input: string, defaultCountryCode = DEFAULT_COUNTRY_CODE): E164 | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  let candidate: string;

  if (trimmed.startsWith("+")) {
    candidate = `+${digits}`;
  } else if (digits.startsWith("00")) {
    candidate = `+${digits.slice(2)}`;
  } else if (defaultCountryCode === "91" && digits.length === 11 && digits.startsWith("0")) {
    candidate = `+91${digits.slice(1)}`;
  } else if (defaultCountryCode === "91" && digits.length === 12 && digits.startsWith("91")) {
    candidate = `+${digits}`;
  } else {
    candidate = `+${defaultCountryCode}${digits}`;
  }

  return isValidE164(candidate) ? candidate : null;
}

/** `+919876543210` → `+91 98765 43210`; other countries are returned unchanged. */
export function formatPhone(phone: string): string {
  if (INDIAN_MOBILE_PATTERN.test(phone)) {
    return `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;
  }
  return phone;
}

/** `+919876543210` → `+91 ••••• •3210`, for showing where an OTP was sent. */
export function maskPhone(phone: string): string {
  const lastFour = phone.slice(-4);
  if (INDIAN_MOBILE_PATTERN.test(phone)) return `+91 ••••• •${lastFour}`;
  return `${phone.slice(0, 3)}•••••${lastFour}`;
}
