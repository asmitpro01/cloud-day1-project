// Minimal types for Razorpay Standard Checkout (https://checkout.razorpay.com/v1/checkout.js).

type RazorpaySuccessResponse = {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  name: string;
  description: string;
  image?: string;
  order_id?: string;
  subscription_id?: string;
  amount?: number;
  currency?: "INR";
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void; confirm_close?: boolean };
};

type RazorpayFailure = { error: { code: string; description: string; reason?: string } };

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: (response: RazorpayFailure) => void): void;
}

interface Window {
  Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
}
