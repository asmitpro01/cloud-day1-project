"use client";

import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { authErrorMessage } from "./auth-errors";
import { Divider } from "./divider";
import { EmailSignInForm } from "./email-sign-in-form";
import { FormError } from "./form-message";
import { GoogleButton } from "./google-button";
import { PhoneOtpForm } from "./phone-otp-form";

export function SignInMethods({ phone, google }: { phone: boolean; google: boolean }) {
  const params = useSearchParams();
  const redirectTo = safeRedirectPath(params.get("next"));
  const oauthError = params.get("error");

  return (
    <div className="space-y-6">
      {oauthError ? <FormError message={authErrorMessage(oauthError)} /> : null}
      {phone ? (
        <Tabs defaultValue="phone">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="phone">Phone OTP</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
          </TabsList>
          <TabsContent value="phone" className="pt-4">
            <PhoneOtpForm redirectTo={redirectTo} />
          </TabsContent>
          <TabsContent value="email" className="pt-4">
            <EmailSignInForm redirectTo={redirectTo} />
          </TabsContent>
        </Tabs>
      ) : (
        <EmailSignInForm redirectTo={redirectTo} />
      )}
      {google ? (
        <>
          <Divider label="or" />
          <GoogleButton redirectTo={redirectTo} errorRedirect="/sign-in" />
        </>
      ) : null}
    </div>
  );
}
