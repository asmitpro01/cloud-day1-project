import type { Metadata } from "next";
import { site } from "@/config/site";
import { CompanyBlock, LegalPage } from "../../_components/legal-page";

export const metadata: Metadata = { title: "Refund & Cancellation Policy" };

export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy">
      <h2>Subscriptions</h2>
      <p>
        You can cancel a subscription at any time from Billing. Cancellation takes effect at the end of the current
        billing period, and you keep access until then. We don&apos;t charge cancellation fees.
      </p>
      <h2>Refunds</h2>
      <ul>
        <li>Pre-orders are fully refundable until the product is delivered.</li>
        <li>New purchases can be refunded within 7 days if the product doesn&apos;t work as described.</li>
        <li>Renewals are refundable within 48 hours of the charge if you haven&apos;t used the Service since.</li>
      </ul>
      <p>
        To request a refund, email <a href={`mailto:${site.brand.supportEmail}`}>{site.brand.supportEmail}</a> with your
        invoice number. Approved refunds are credited to the original payment method within 5–7 working days, and we
        issue a credit note for the GST invoice.
      </p>
      <h2>Contact</h2>
      <CompanyBlock />
    </LegalPage>
  );
}
