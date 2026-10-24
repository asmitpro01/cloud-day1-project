import type { Metadata } from "next";
import { getBillingProfile } from "@/server/account/billing-profile";
import { getAuthMethods } from "@/server/auth/methods";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { BillingProfileForm } from "./_components/billing-profile-form";
import { EmailForm } from "./_components/email-form";
import { PhoneForm } from "./_components/phone-form";
import { PrivacySection } from "./_components/privacy-section";
import { ProfileForm } from "./_components/profile-form";
import { SettingsSection } from "./_components/section";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const billingProfile = await getBillingProfile(getDb(), user.id);
  const methods = getAuthMethods();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your profile, billing details and privacy.</p>
      </div>
      <SettingsSection id="profile" title="Profile" description="How we address you.">
        <ProfileForm name={user.name} />
      </SettingsSection>
      <SettingsSection id="email" title="Email" description="Where we send invoices and account notices.">
        <EmailForm email={user.hasRealEmail ? user.email : null} verified={user.emailVerified} />
      </SettingsSection>
      {methods.phone ? (
        <SettingsSection id="phone" title="Mobile number" description="Used for OTP sign-in. Verified by SMS.">
          <PhoneForm phoneNumber={user.phoneNumber} />
        </SettingsSection>
      ) : null}
      <SettingsSection
        id="billing"
        title="Billing details"
        description="Printed on your GST invoices. Your state decides whether we charge CGST + SGST or IGST."
      >
        <BillingProfileForm defaults={billingProfile} />
      </SettingsSection>
      <SettingsSection id="privacy" title="Privacy" description="Your rights under the DPDP Act, 2023.">
        <PrivacySection />
      </SettingsSection>
    </div>
  );
}
