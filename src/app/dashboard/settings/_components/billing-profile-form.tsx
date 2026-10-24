"use client";

import { useFormAction } from "@/components/use-form-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GST_STATES } from "@/lib/gst/states";
import { saveBillingProfileAction } from "../actions";
import { ActionMessage, FieldError } from "./section";

export type BillingProfileDefaults = {
  legalName: string;
  gstin: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateCode: string;
  pincode: string;
};

export function BillingProfileForm({ defaults }: { defaults: BillingProfileDefaults | null }) {
  const { state, pending, onSubmit } = useFormAction(saveBillingProfileAction);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="legalName">Name on invoice</Label>
        <Input
          id="legalName"
          name="legalName"
          defaultValue={defaults?.legalName}
          placeholder="Your name or registered business name"
          required
          aria-describedby="legalName-error"
        />
        <FieldError id="legalName-error" messages={errors?.legalName} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="gstin">
          GSTIN <span className="font-normal text-muted-foreground">(optional, for business purchases)</span>
        </Label>
        <Input
          id="gstin"
          name="gstin"
          defaultValue={defaults?.gstin ?? ""}
          placeholder="27AAPFU0939F1ZV"
          maxLength={15}
          className="font-mono uppercase"
          aria-describedby="gstin-error"
        />
        <FieldError id="gstin-error" messages={errors?.gstin} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="addressLine1">Address</Label>
        <Input
          id="addressLine1"
          name="addressLine1"
          defaultValue={defaults?.addressLine1}
          autoComplete="address-line1"
          required
          aria-describedby="addressLine1-error"
        />
        <FieldError id="addressLine1-error" messages={errors?.addressLine1} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="addressLine2">
          Address line 2 <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="addressLine2"
          name="addressLine2"
          defaultValue={defaults?.addressLine2 ?? ""}
          autoComplete="address-line2"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="city">City</Label>
        <Input
          id="city"
          name="city"
          defaultValue={defaults?.city}
          autoComplete="address-level2"
          required
          aria-describedby="city-error"
        />
        <FieldError id="city-error" messages={errors?.city} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pincode">PIN code</Label>
        <Input
          id="pincode"
          name="pincode"
          defaultValue={defaults?.pincode}
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          required
          aria-describedby="pincode-error"
        />
        <FieldError id="pincode-error" messages={errors?.pincode} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="stateCode">State (place of supply)</Label>
        <select
          id="stateCode"
          name="stateCode"
          defaultValue={defaults?.stateCode ?? ""}
          required
          aria-describedby="stateCode-error"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="" disabled>
            Select your state
          </option>
          {GST_STATES.map((state) => (
            <option key={state.code} value={state.code}>
              {state.code} – {state.name}
            </option>
          ))}
        </select>
        <FieldError id="stateCode-error" messages={errors?.stateCode} />
      </div>
      <div className="space-y-3 sm:col-span-2">
        <ActionMessage result={state} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save billing details"}
        </Button>
      </div>
    </form>
  );
}
