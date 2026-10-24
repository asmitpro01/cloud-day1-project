import type { ReactNode } from "react";
import { site } from "@/config/site";

/** Shared frame for the policy pages Razorpay asks for during account activation. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 [&_a]:underline [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-4 [&_p]:leading-7 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:pl-6">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">Last updated: {site.legal.lastUpdated}</p>
      <aside className="mt-6 rounded-lg bg-muted p-4 text-sm text-muted-foreground">
        Template provided with {site.brand.name}. Have a lawyer review it for your business before relying on it.
      </aside>
      <div className="text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </article>
  );
}

export function CompanyBlock() {
  const { company } = site;
  return (
    <p>
      <strong>{company.legalName}</strong>
      <br />
      {company.address.line1}
      {company.address.line2 ? `, ${company.address.line2}` : ""}, {company.address.city} {company.address.pincode}
      <br />
      GSTIN: {company.gstin} · Email: <a href={`mailto:${company.email}`}>{company.email}</a> · Phone: {company.phone}
    </p>
  );
}
