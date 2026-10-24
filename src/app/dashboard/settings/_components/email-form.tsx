"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { email: string | null; verified: boolean };

export function EmailForm({ email, verified }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newEmail = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setMessage(null);
    const { error } = await authClient.changeEmail({ newEmail, callbackURL: "/dashboard/settings" });
    setPending(false);
    if (error) {
      setMessage({ type: "error", text: error.message ?? "Couldn't update your email." });
      return;
    }
    setMessage({
      type: "ok",
      text: verified
        ? `We've sent a confirmation link. Your email changes once you approve it.`
        : `Saved. Check ${newEmail} for a verification link.`,
    });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {email ? (
        <p className="flex items-center gap-2 text-sm">
          {email}
          {verified ? <Badge variant="secondary">Verified</Badge> : <Badge variant="outline">Not verified</Badge>}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="new-email">{email ? "New email" : "Email for invoices"}</Label>
        <Input id="new-email" name="email" type="email" autoComplete="email" required />
      </div>
      {message ? (
        <p
          role={message.type === "ok" ? "status" : "alert"}
          className={message.type === "ok" ? "text-sm text-success" : "text-sm text-destructive"}
        >
          {message.text}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : email ? "Change email" : "Add email"}
      </Button>
    </form>
  );
}
