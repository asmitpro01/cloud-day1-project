import { AppError } from "@/lib/errors";

export class OtpDeliveryError extends AppError {
  constructor(message: string, options?: ErrorOptions) {
    super("OTP_DELIVERY_FAILED", message, options);
  }
}
