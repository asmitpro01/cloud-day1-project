"use client";

import Link from "next/link";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { acceptConsentAction } from "../actions";
import { Divider } from "./divider";
import { EmailSignUpForm } from "./email-sign-up-form";
import { FormError } from "./form-message";
import { GoogleButton } from "./google-button";
import { PhoneOtpForm } from "./phone-otp-form";

const REDIRECT_TO = "/dashboard";

export function SignUpMethods({ phone, google }: { phone: boolean; google: boolean }) {
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Every sign-up method calls this first: no account without recorded consent. */
  async function ensureConsent(): Promise<boolean> {
    if (!consented) {
      setError("Please accept the Terms and Privacy Policy to continue.");
      return false;
    }
    setError(null);
    const result = await acceptConsentAction();
    if (!result.ok) setError(result.error.message);
    return result.ok;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox
          id="consent"
          checked={consented}
          onCheckedChange={(value) => {
            setConsented(value === true);
            if (value === true) setError(null);
          }}
          aria-describedby="consent-error"
          className="mt-0.5"
        />
        <Label htmlFor="consent" className="block text-sm leading-5 font-normal text-muted-foreground">
          I agree to the{" "}
          <Link href="/legal/terms" target="_blank" className="text-foreground underline">
            Terms of Service
          </Link>{" "}
          and consent to processing of my personal data as described in the{" "}
          <Link href="/legal/privacy" target="_blank" className="text-foreground underline">
            Privacy Policy
          </Link>
          .
        </Label>
      </div>
      <div id="consent-error">
        <FormError message={error} />
      </div>
      {phone ? (
        <Tabs defaultValue="phone">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="phone">Phone OTP</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
          </TabsList>
          <TabsContent value="phone" className="pt-4">
            <PhoneOtpForm redirectTo={REDIRECT_TO} beforeSend={ensureConsent} />
          </TabsContent>
          <TabsContent value="email" className="pt-4">
            <EmailSignUpForm redirectTo={REDIRECT_TO} beforeSubmit={ensureConsent} />
          </TabsContent>
        </Tabs>
      ) : (
        <EmailSignUpForm redirectTo={REDIRECT_TO} beforeSubmit={ensureConsent} />
      )}
      {google ? (
        <>
          <Divider label="or" />
          <GoogleButton redirectTo={REDIRECT_TO} errorRedirect="/sign-up" beforeRedirect={ensureConsent} />
        </>
      ) : null}
    </div>
  );
}
