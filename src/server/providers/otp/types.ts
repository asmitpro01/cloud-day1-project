/** Delivers a one-time code by SMS. Code generation, expiry and attempts are handled by Better Auth. */
export interface OtpSender {
  readonly name: string;
  /** `to` is E.164 (`+919876543210`). Throw `OtpDeliveryError` when the provider rejects the message. */
  send(input: { to: string; code: string; expiresInMinutes: number }): Promise<void>;
}
