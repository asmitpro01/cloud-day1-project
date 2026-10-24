import type { Metadata } from "next";
import { site } from "@/config/site";
import { CompanyBlock } from "../_components/legal-page";

export const metadata: Metadata = { title: "Contact us" };

export default function ContactPage() {
  const officer = site.legal.grievanceOfficer;
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 [&_a]:underline [&_p]:mt-4 [&_p]:leading-7">
      <h1 className="text-3xl font-bold tracking-tight">Contact us</h1>
      <div className="text-muted-foreground [&_strong]:text-foreground">
        <p>
          Support: <a href={`mailto:${site.brand.supportEmail}`}>{site.brand.supportEmail}</a>. We reply within one
          working day, Monday to Friday, 10:00–18:00 IST.
        </p>
        <CompanyBlock />
        <p>
          Grievance Officer: {officer.name}, <a href={`mailto:${officer.email}`}>{officer.email}</a>
        </p>
      </div>
    </section>
  );
}
