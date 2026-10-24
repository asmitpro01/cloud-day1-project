import { z } from "zod";
import { checkGstin, GSTIN_ERROR_MESSAGES } from "@/lib/gst/gstin";
import { gstStateCodeSchema } from "@/lib/gst/states";

/**
 * ★ The one business config file: brand, company identity, GST and invoice settings.
 *
 * Everything that prints on an invoice or the landing page comes from here.
 * The GST defaults are placeholders. This kit is a tool, not tax advice:
 * confirm the rate, SAC code and invoice series with your CA before going live.
 */
const rawSite = {
  brand: {
    name: "Desi SaaS Kit",
    tagline: "The India-first Next.js SaaS boilerplate",
    description:
      "Next.js SaaS boilerplate with Razorpay subscriptions, GST-compliant invoices and Indian OTP login. Live in under 30 minutes.",
    logoPath: "/brand/logo.svg",
    // Primary colours for light and dark mode. Pick pairs with at least 4.5:1 contrast.
    colors: {
      light: { primary: "#c2410c", primaryForeground: "#ffffff" },
      dark: { primary: "#fb923c", primaryForeground: "#1c1917" },
    },
    supportEmail: "support@example.com",
    social: {
      twitter: "https://x.com/example",
      github: "https://github.com/example",
    },
  },

  /** Your legal entity, exactly as registered on the GST portal. */
  company: {
    legalName: "Example Technologies Private Limited",
    gstin: "27AAPFU0939F1ZV",
    cin: "U72900MH2020PTC000000",
    address: {
      line1: "Office 401, Example Towers",
      line2: "Bandra Kurla Complex",
      city: "Mumbai",
      stateCode: "27",
      pincode: "400051",
    },
    email: "billing@example.com",
    phone: "+91 22 0000 0000",
  },

  gst: {
    /** Tax rate in basis points: 1800 = 18%. */
    rateBps: 1800,
    /** SAC for the service you sell. 998314 = IT design & development; 997331 or 998315 are also common for SaaS. */
    sacCode: "998314",
    /** "inclusive": plan prices already include GST (common for B2C). "exclusive": GST is added on top. */
    pricingMode: "inclusive",
    /** Line item text on invoices, e.g. "Pro plan (monthly) – software subscription". */
    serviceDescription: "Software subscription",
  },

  invoice: {
    /** Series prefix. Invoice numbers look like INV/2627/000042 (max 16 characters per CGST Rule 46). */
    prefix: "INV",
    /** Digits in the running counter; 6 allows 999,999 invoices per financial year. */
    counterDigits: 6,
    footerNote: "This is a computer-generated invoice and does not require a signature.",
  },

  legal: {
    /** Courts with jurisdiction, used in the Terms template. */
    jurisdictionCity: "Mumbai",
    /** Grievance Officer required under the IT Rules 2021 and DPDP Act 2023. */
    grievanceOfficer: { name: "Priya Sharma", email: "grievance@example.com" },
    /** Bump when your privacy policy changes; stored with each user's consent. */
    privacyPolicyVersion: "2026-10-01",
    lastUpdated: "1 October 2026",
  },
} as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #c2410c");

const siteSchema = z
  .object({
    brand: z.object({
      name: z.string().min(1),
      tagline: z.string(),
      description: z.string(),
      logoPath: z.string().startsWith("/"),
      colors: z.object({
        light: z.object({ primary: hexColor, primaryForeground: hexColor }),
        dark: z.object({ primary: hexColor, primaryForeground: hexColor }),
      }),
      supportEmail: z.email(),
      social: z.object({ twitter: z.url().optional(), github: z.url().optional() }),
    }),
    company: z.object({
      legalName: z.string().min(1),
      gstin: z.string(),
      cin: z.string().optional(),
      address: z.object({
        line1: z.string().min(1),
        line2: z.string().optional(),
        city: z.string().min(1),
        stateCode: gstStateCodeSchema,
        pincode: z.string().regex(/^[1-9]\d{5}$/, "Pincode must be 6 digits"),
      }),
      email: z.email(),
      phone: z.string(),
    }),
    gst: z.object({
      rateBps: z.number().int().min(0).max(4000),
      sacCode: z.string().regex(/^99\d{4}$/, "SAC codes are 6 digits starting with 99"),
      pricingMode: z.enum(["inclusive", "exclusive"]),
      serviceDescription: z.string().min(1),
    }),
    invoice: z.object({
      prefix: z.string().regex(/^[A-Z0-9-]{1,8}$/, "Use up to 8 characters from A-Z, 0-9 and -"),
      counterDigits: z.number().int().min(3).max(8),
      footerNote: z.string(),
    }),
    legal: z.object({
      jurisdictionCity: z.string(),
      grievanceOfficer: z.object({ name: z.string(), email: z.email() }),
      privacyPolicyVersion: z.string().min(1),
      lastUpdated: z.string(),
    }),
  })
  .superRefine((site, ctx) => {
    const gstin = checkGstin(site.company.gstin);
    if (!gstin.valid) {
      ctx.addIssue({ code: "custom", path: ["company", "gstin"], message: GSTIN_ERROR_MESSAGES[gstin.reason] });
    } else if (gstin.stateCode !== site.company.address.stateCode) {
      ctx.addIssue({
        code: "custom",
        path: ["company", "address", "stateCode"],
        message: `Company state ${site.company.address.stateCode} doesn't match GSTIN state ${gstin.stateCode}`,
      });
    }
    // PREFIX + "/" + 4-digit FY code + "/" + counter must fit in 16 characters (CGST Rule 46).
    const longest = site.invoice.prefix.length + 1 + 4 + 1 + site.invoice.counterDigits;
    if (longest > 16) {
      ctx.addIssue({
        code: "custom",
        path: ["invoice"],
        message: `Invoice numbers would be ${longest} characters; GST allows at most 16. Shorten the prefix or counter.`,
      });
    }
  });

/** Validated at import, so a typo in this file fails the build instead of printing on an invoice. */
export const site = siteSchema.parse(rawSite);

export type Site = typeof site;
