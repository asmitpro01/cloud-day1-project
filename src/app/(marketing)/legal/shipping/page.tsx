import type { Metadata } from "next";
import { site } from "@/config/site";
import { CompanyBlock, LegalPage } from "../../_components/legal-page";

export const metadata: Metadata = { title: "Shipping & Delivery Policy" };

export default function ShippingPage() {
  return (
    <LegalPage title="Shipping & Delivery Policy">
      <p>{site.brand.name} is a digital product. Nothing is shipped physically and no delivery charges apply.</p>
      <ul>
        <li>Subscriptions are activated immediately after a successful payment.</li>
        <li>Downloadable products are delivered by email to the address used at checkout, usually within minutes.</li>
        <li>Pre-orders are delivered by email on the launch date shown at the time of purchase.</li>
      </ul>
      <p>
        If you haven&apos;t received access within 24 hours, write to{" "}
        <a href={`mailto:${site.brand.supportEmail}`}>{site.brand.supportEmail}</a>.
      </p>
      <h2>Contact</h2>
      <CompanyBlock />
    </LegalPage>
  );
}
