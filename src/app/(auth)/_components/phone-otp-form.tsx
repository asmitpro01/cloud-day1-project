"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { authErrorMessage } from "./auth-errors";
import { FormError } from "./form-message";

const RESEND_COOLDOWN_SECONDS = 30;

type Props = {
  redirectTo: string;
  /** Runs before an OTP is requested; return false to stop (e.g. consent not given). */
  beforeSend?: () => Promise<boolean>;
};

export function PhoneOtpForm({ redirectTo, beforeSend }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [rawPhone, setRawPhone] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(target: string) {
    setPending(true);
    setError(null);
    const { error: sendError } = await authClient.phoneNumber.sendOtp({ phoneNumber: target });
    setPending(false);
    if (sendError) {
      setError(authErrorMessage(sendError));
      return false;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    return true;
  }

  async function onSubmitPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizePhone(rawPhone);
    if (!normalized) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    if (beforeSend && !(await beforeSend())) return;
    if (await sendCode(normalized)) {
      setPhone(normalized);
      setStep("code");
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!phone) return;
    setPending(true);
    setError(null);
    const { error: verifyError } = await authClient.phoneNumber.verify({ phoneNumber: phone, code });
    if (verifyError) {
      setPending(false);
      setError(authErrorMessage(verifyError));
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  if (step === "code" && phone) {
    return (
      <form onSubmit={onSubmitCode} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="otp">Enter the 6-digit code sent to {maskPhone(phone)}</Label>
          <Input
            id="otp"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="text-center font-mono text-lg tracking-[0.5em]"
          />
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
          {pending ? "Verifying…" : "Verify and continue"}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
          >
            Change number
          </button>
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline"
            disabled={cooldown > 0 || pending}
            onClick={() => void sendCode(phone)}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitPhone} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone">Mobile number</Label>
        <div className="flex">
          <span className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
            +91
          </span>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="98765 43210"
            required
            value={rawPhone}
            onChange={(event) => setRawPhone(event.target.value)}
            className="rounded-l-none"
          />
        </div>
        <p className="text-xs text-muted-foreground">Outside India? Type your number with its country code, e.g. +1…</p>
      </div>
      <FormError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending code…" : "Send OTP"}
      </Button>
    </form>
  );
}
