import "server-only";

const PLACEHOLDER_DOMAIN = "@users.invalid";

/** Placeholder email for accounts created by phone OTP; `.invalid` is reserved (RFC 2606) and never delivered. */
export function placeholderEmailForPhone(phone: string): string {
  return `phone-${phone.replace(/\D/g, "")}${PLACEHOLDER_DOMAIN}`;
}

export function isPlaceholderEmail(email: string): boolean {
  return email.endsWith(PLACEHOLDER_DOMAIN);
}
