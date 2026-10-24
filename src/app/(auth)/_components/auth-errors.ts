const MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code isn't right. Check the SMS and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  OTP_NOT_FOUND: "Request a new code first.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Request a new one.",
  INVALID_PHONE_NUMBER: "Enter a valid mobile number.",
  PHONE_NUMBER_EXIST: "That number is already linked to another account.",
  INVALID_EMAIL_OR_PASSWORD: "Email or password is incorrect.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in instead.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Sign in instead.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for your password.",
  EMAIL_NOT_VERIFIED: "Please verify your email first. We've sent you a new link.",
  CONSENT_REQUIRED: "New here? Create an account and accept the Terms and Privacy Policy first.",
  INVALID_TOKEN: "This link is invalid or has expired. Request a new one.",
  unable_to_link_account: "We couldn't link your Google account. Sign in with your existing method first.",
};

type AuthClientError = { code?: string | undefined; message?: string | undefined } | null | undefined;

/** Turns a Better Auth client error (or OAuth `?error=` code) into a friendly message. */
export function authErrorMessage(error: AuthClientError | string): string {
  if (!error) return "Something went wrong. Please try again.";
  if (typeof error === "string") return MESSAGES[error] ?? "Sign-in failed. Please try again.";
  return (error.code ? MESSAGES[error.code] : undefined) ?? error.message ?? "Something went wrong. Please try again.";
}
