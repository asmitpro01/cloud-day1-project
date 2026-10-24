"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone, normalizePhone } from "@/lib/phone";

export function PhoneForm({ phoneNumber }: { phoneNumber: string | null }) {
  const router = useRouter();
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = normalizePhone(String(new FormData(event.currentTarget).get("phone") ?? ""));
    if (!phone) {
      setMessage({ type: "error", text: "Enter a valid 10-digit mobile number." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
    setBusy(false);
    if (error) {
      setMessage({ type: "error", text: error.message ?? "Couldn't send the code." });
      return;
    }
    setPendingPhone(phone);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingPhone) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setBusy(true);
    const { error } = await authClient.phoneNumber.verify({ phoneNumber: pendingPhone, code, updatePhoneNumber: true });
    setBusy(false);
    if (error) {
      setMessage({ type: "error", text: error.message ?? "That code isn't right." });
      return;
    }
    setPendingPhone(null);
    setMessage({ type: "ok", text: "Mobile number verified and saved." });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {phoneNumber ? (
        <p className="flex items-center gap-2 text-sm">
          {formatPhone(phoneNumber)} <Badge variant="secondary">Verified</Badge>
        </p>
      ) : null}
      {pendingPhone ? (
        <form onSubmit={verifyCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-otp">Code sent to {formatPhone(pendingPhone)}</Label>
            <Input
              id="settings-otp"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              autoFocus
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
        </form>
      ) : (
        <form onSubmit={sendCode} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-phone">{phoneNumber ? "New mobile number" : "Mobile number"}</Label>
            <Input id="settings-phone" name="phone" type="tel" inputMode="tel" placeholder="98765 43210" required />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send OTP"}
          </Button>
        </form>
      )}
      {message ? (
        <p
          role={message.type === "ok" ? "status" : "alert"}
          className={message.type === "ok" ? "text-sm text-success" : "text-sm text-destructive"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
