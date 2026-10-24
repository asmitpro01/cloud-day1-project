import { AppError } from "@/lib/errors";

export class BillingError extends AppError {}

export const billingErrors = {
  disabled: () => new BillingError("BILLING_DISABLED", "Payments are not configured on this deployment."),
  profileRequired: () =>
    new BillingError("BILLING_PROFILE_REQUIRED", "Add your billing address first so we can issue a GST invoice."),
  alreadySubscribed: () =>
    new BillingError("ALREADY_SUBSCRIBED", "You already have an active subscription. Change your plan instead."),
  notForSale: () => new BillingError("NOT_FOR_SALE", "That plan isn't available for this billing interval."),
  invalidSignature: () =>
    new BillingError("INVALID_SIGNATURE", "We couldn't verify this payment. If you were charged, contact support."),
  notFound: () => new BillingError("NOT_FOUND", "We couldn't find that purchase."),
  noSubscription: () => new BillingError("NO_SUBSCRIPTION", "You don't have an active subscription."),
  amountMismatch: () =>
    new BillingError("AMOUNT_MISMATCH", "The payment amount doesn't match the order. Contact support."),
};
