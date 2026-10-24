"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatINR, paise } from "@/lib/money";
import type { CheckoutSession } from "@/server/billing/checkout";
import { simulateFakeCheckoutAction, startCheckoutAction, verifyCheckoutAction } from "../actions";

export type CheckoutRequestInput =
  { kind: "subscription"; planKey: string; interval: "monthly" | "yearly" } | { kind: "order"; productKey: string };

let checkoutScript: Promise<void> | null = null;

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutScript = null;
      reject(new Error("Couldn't load Razorpay Checkout. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return checkoutScript;
}

type Props = {
  request: CheckoutRequestInput;
  label: string;
  themeColor: string;
  variant?: "default" | "outline";
  disabled?: boolean;
};

export function CheckoutButton({ request, label, themeColor, variant = "default", disabled }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fakeSession, setFakeSession] = useState<CheckoutSession | null>(null);

  async function finish(response: Parameters<typeof verifyCheckoutAction>[0]) {
    const result = await verifyCheckoutAction(response);
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.data.status !== "captured") {
      setError("Payment received but not yet confirmed. We'll update this page once Razorpay confirms it.");
    }
    router.refresh();
  }

  async function openRazorpay(session: CheckoutSession) {
    await loadRazorpayCheckout();
    const Razorpay = window.Razorpay;
    if (!Razorpay) throw new Error("Razorpay Checkout is unavailable.");
    const checkout = new Razorpay({
      key: session.keyId,
      name: session.merchantName,
      description: session.description,
      prefill: session.prefill,
      theme: { color: themeColor },
      ...(session.kind === "order"
        ? { order_id: session.orderId, amount: session.amountPaise, currency: "INR" as const }
        : { subscription_id: session.subscriptionId }),
      handler: (response) => {
        void finish(
          session.kind === "order"
            ? {
                kind: "order",
                orderId: session.orderId,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }
            : {
                kind: "subscription",
                subscriptionId: session.subscriptionId,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              },
        );
      },
      modal: { ondismiss: () => setPending(false) },
    });
    checkout.on("payment.failed", (failure) => setError(failure.error.description));
    checkout.open();
  }

  async function onClick() {
    setPending(true);
    setError(null);
    const result = await startCheckoutAction(request);
    if (!result.ok) {
      setPending(false);
      setError(result.error.message);
      return;
    }
    if (result.data.provider === "fake") {
      setFakeSession(result.data);
      return;
    }
    try {
      await openRazorpay(result.data);
    } catch (caught) {
      setPending(false);
      setError(caught instanceof Error ? caught.message : "Couldn't open checkout.");
    }
  }

  async function payWithSimulator(session: CheckoutSession) {
    setFakeSession(null);
    const simulated = await simulateFakeCheckoutAction(
      session.kind === "order"
        ? { kind: "order", orderId: session.orderId }
        : { kind: "subscription", subscriptionId: session.subscriptionId },
    );
    if (!simulated.ok) {
      setPending(false);
      setError(simulated.error.message);
      return;
    }
    await finish(simulated.data);
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" variant={variant} onClick={() => void onClick()} disabled={disabled || pending}>
        {pending ? "Processing…" : label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog
        open={fakeSession !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFakeSession(null);
            setPending(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test checkout</DialogTitle>
            <DialogDescription>
              PAYMENTS_PROVIDER=fake: no real money moves. The payment is signed and verified exactly like a Razorpay
              one.
            </DialogDescription>
          </DialogHeader>
          {fakeSession ? (
            <p className="text-sm">
              {fakeSession.description}: <strong>{formatINR(paise(fakeSession.amountPaise))}</strong>
            </p>
          ) : null}
          <DialogFooter>
            <Button onClick={() => fakeSession && void payWithSimulator(fakeSession)}>
              Simulate successful payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
