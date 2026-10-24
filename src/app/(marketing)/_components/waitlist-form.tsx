"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/result";
import { joinWaitlistAction } from "../actions";

export function WaitlistForm() {
  const [state, formAction, pending] = useActionState<ActionResult<{ message: string }> | null, FormData>(
    joinWaitlistAction,
    null,
  );
  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;

  if (state?.ok) {
    return (
      <p role="status" className="rounded-lg border bg-card p-6 text-center font-medium">
        {state.data.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-xl border bg-card p-6" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="waitlist-name">Name</Label>
          <Input
            id="waitlist-name"
            name="name"
            autoComplete="name"
            required
            aria-invalid={Boolean(fieldErrors?.name)}
            aria-describedby="waitlist-name-error"
          />
          {fieldErrors?.name ? (
            <p id="waitlist-name-error" className="text-sm text-destructive">
              {fieldErrors.name[0]}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="waitlist-email">Email</Label>
          <Input
            id="waitlist-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={Boolean(fieldErrors?.email)}
            aria-describedby="waitlist-email-error"
          />
          {fieldErrors?.email ? (
            <p id="waitlist-email-error" className="text-sm text-destructive">
              {fieldErrors.email[0]}
            </p>
          ) : null}
        </div>
      </div>
      {/* Honeypot: hidden from people, filled by bots. */}
      <div className="hidden" aria-hidden>
        <label>
          Company <input name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      {state && !state.ok && !fieldErrors ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Join the waitlist"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">No spam. One email when early access opens.</p>
    </form>
  );
}
