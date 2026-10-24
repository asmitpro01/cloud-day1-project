import type { Metadata } from "next";
import { site } from "@/config/site";
import { CompanyBlock, LegalPage } from "../../_components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const officer = site.legal.grievanceOfficer;
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains how {site.company.legalName} (&quot;we&quot;) processes your personal data when you use{" "}
        {site.brand.name}, in line with the Digital Personal Data Protection Act, 2023 (DPDP Act) and the Information
        Technology Act, 2000. Policy version: {site.legal.privacyPolicyVersion}.
      </p>
      <h2>Data we collect</h2>
      <ul>
        <li>Account data: name, email address, phone number and a hashed password, if you set one.</li>
        <li>Billing data: billing name, address, state and GSTIN (optional), needed to issue GST invoices.</li>
        <li>
          Payment data: payment status, method type and Razorpay references. Card and bank details are handled by
          Razorpay; we never see or store them.
        </li>
        <li>
          Technical data: IP address, browser user agent and session records, used for security and rate limiting.
        </li>
      </ul>
      <h2>Why we process it</h2>
      <p>
        To provide the Service, process payments, issue invoices, prevent fraud and abuse, and meet legal obligations.
        We rely on the consent you give at signup and, for tax records, on our legal obligations.
      </p>
      <h2>Who we share it with</h2>
      <p>
        Processors that help us run the Service: Razorpay (payments), our SMS provider (OTP delivery), our email
        provider (transactional email) and our hosting and database providers. We do not sell personal data.
      </p>
      <h2>Retention</h2>
      <p>
        We keep account data while your account is active. When you delete your account we erase your personal data,
        except invoices and payment records, which the CGST Act requires us to retain for at least 72 months from the
        due date of the relevant annual return.
      </p>
      <h2>Your rights</h2>
      <ul>
        <li>Access and download your data from Settings → Privacy (JSON export).</li>
        <li>Correct your details from Settings at any time.</li>
        <li>Erase your account from Settings → Privacy.</li>
        <li>Withdraw consent by deleting your account or writing to the Grievance Officer.</li>
        <li>Nominate another person to exercise your rights in the event of death or incapacity.</li>
      </ul>
      <h2>Grievance Officer</h2>
      <p>
        {officer.name}, <a href={`mailto:${officer.email}`}>{officer.email}</a>. We acknowledge complaints within 24
        hours and resolve them within the timelines set by law. You may also approach the Data Protection Board of
        India.
      </p>
      <h2>Contact</h2>
      <CompanyBlock />
    </LegalPage>
  );
}
