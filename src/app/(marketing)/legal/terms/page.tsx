import type { Metadata } from "next";
import { site } from "@/config/site";
import { CompanyBlock, LegalPage } from "../../_components/legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern your use of {site.brand.name} (the &quot;Service&quot;), operated by {site.company.legalName}{" "}
        (&quot;we&quot;, &quot;us&quot;). By creating an account or making a purchase you agree to them.
      </p>
      <h2>Accounts</h2>
      <p>
        You must provide accurate information and keep your login credentials, including access to the phone number used
        for OTP login, secure. You are responsible for activity under your account.
      </p>
      <h2>Payments and taxes</h2>
      <p>
        Prices are in Indian Rupees (₹). Unless stated otherwise, prices include GST at the applicable rate. Payments
        are processed by Razorpay. Subscriptions renew automatically at the end of each billing period until cancelled.
        A GST tax invoice is issued for every successful charge.
      </p>
      <h2>Acceptable use</h2>
      <ul>
        <li>No unlawful, infringing or harmful content or activity.</li>
        <li>No attempts to break, overload or reverse-engineer the Service&apos;s security.</li>
        <li>No reselling access to the Service without our written permission.</li>
      </ul>
      <h2>Intellectual property</h2>
      <p>
        We own the Service and its content. Purchases of downloadable source code are licensed as described on the
        pricing page. You keep ownership of the data you put into the Service.
      </p>
      <h2>Liability</h2>
      <p>
        The Service is provided &quot;as is&quot;. To the extent permitted by law, our total liability for any claim is
        limited to the amount you paid us in the 12 months before the claim. Nothing in the Service is tax, legal or
        financial advice.
      </p>
      <h2>Termination</h2>
      <p>
        You may delete your account at any time from your settings. We may suspend accounts that breach these terms.
      </p>
      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of India, and the courts at {site.legal.jurisdictionCity} have exclusive
        jurisdiction.
      </p>
      <h2>Contact</h2>
      <CompanyBlock />
    </LegalPage>
  );
}
