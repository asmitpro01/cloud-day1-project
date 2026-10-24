import "server-only";
import { serverEnv } from "@/env/server";
import { createFakeProvider, type FakeProvider } from "./fake";
import { createRazorpayProvider } from "./razorpay/adapter";
import type { PaymentProvider } from "./types";

let provider: PaymentProvider | null | undefined;
let fakeProvider: FakeProvider | undefined;

/** The configured payment provider, or `null` when billing is disabled (`PAYMENTS_PROVIDER=none`). */
export function getPaymentProvider(): PaymentProvider | null {
  if (provider === undefined) {
    const config = serverEnv().payments;
    switch (config.provider) {
      case "razorpay":
        provider = createRazorpayProvider(config);
        break;
      case "fake":
        fakeProvider = createFakeProvider(config);
        provider = fakeProvider;
        break;
      case "none":
        provider = null;
        break;
    }
  }
  return provider;
}

/** The fake provider when it is the configured one (dev/test only), otherwise `null`. */
export function getFakePaymentProvider(): FakeProvider | null {
  getPaymentProvider();
  return fakeProvider ?? null;
}

export type {
  CheckoutResponse,
  PaymentProvider,
  ProviderPayment,
  ProviderSubscription,
  SubscriptionStatus,
  WebhookEvent,
} from "./types";
