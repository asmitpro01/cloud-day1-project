import Link from "next/link";
import { site } from "@/config/site";

const LINKS = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/refunds", label: "Refunds & cancellation" },
  { href: "/legal/shipping", label: "Shipping & delivery" },
  { href: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm space-y-2">
          <p className="font-medium text-foreground">{site.company.legalName}</p>
          <p>
            {site.company.address.city} · GSTIN {site.company.gstin}
          </p>
          <p className="text-xs">
            This kit is a tool, not tax or legal advice. Verify your GST configuration with a CA.
          </p>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
