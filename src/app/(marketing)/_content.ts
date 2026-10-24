import { rupees, type Paise } from "@/lib/money";

/**
 * Landing-page copy for selling THIS KIT. It is separate from `src/config/plans.ts`,
 * which defines the demo SaaS plans that the kit's own billing system sells.
 */

export type KitTier = {
  key: string;
  name: string;
  price: Paise;
  description: string;
  features: string[];
  highlighted: boolean;
};

export const KIT_TIERS: KitTier[] = [
  {
    key: "solo",
    name: "Solo",
    price: rupees(4999),
    description: "One product, one founder, shipping this weekend.",
    features: ["Full source code", "Unlimited projects for yourself", "1 year of updates", "Community support"],
    highlighted: false,
  },
  {
    key: "pro",
    name: "Pro",
    price: rupees(9999),
    description: "For indie hackers running more than one SaaS.",
    features: [
      "Everything in Solo",
      "Lifetime updates",
      "Private Discord with the author",
      "Razorpay + GST setup checklist",
    ],
    highlighted: true,
  },
  {
    key: "agency",
    name: "Agency",
    price: rupees(19999),
    description: "Build client SaaS products under your own brand.",
    features: ["Everything in Pro", "Unlimited client projects", "White-label rights", "Priority email support"],
    highlighted: false,
  },
];

export const FEATURES = [
  {
    icon: "repeat",
    title: "Razorpay subscriptions",
    body: "Monthly and yearly plans with UPI AutoPay and cards, synced from one config file. Webhooks are signature-verified and idempotent.",
  },
  {
    icon: "receipt",
    title: "GST-compliant invoices",
    body: "CGST + SGST, UTGST or IGST by place of supply. Gap-free numbering per financial year, a PDF in the customer's inbox.",
  },
  {
    icon: "smartphone",
    title: "Phone OTP login",
    body: "+91 by default, MSG91 or Twilio behind one adapter. Rate limits per phone and per IP, 30-second resend cooldown.",
  },
  {
    icon: "rupee",
    title: "₹ done right",
    body: "Money stored as integer paise. ₹1,23,456.00 formatting, amounts in words in lakh and crore, dates in IST.",
  },
  {
    icon: "shield",
    title: "DPDP-friendly basics",
    body: "Consent recorded with a timestamp, one-click data export and account deletion, while tax records stay retained.",
  },
  {
    icon: "dashboard",
    title: "Admin with MRR in ₹",
    body: "Users, subscriptions and invoices, plus MRR, active subscriptions, churn this month and a waitlist CSV export.",
  },
] as const;

export const CODE_SAMPLE = `// Gate any feature by plan, checked on the server
import { hasAccess } from "@/server/billing/entitlements";

if (!(await hasAccess(user.id, "reports.export"))) {
  return <UpgradeCard plan="pro" />;
}

// GST from place of supply: Maharashtra seller, Karnataka buyer
import { calculateGst } from "@/lib/gst/tax";

calculateGst({
  amountPaise: rupees(499),
  pricingMode: "inclusive",
  rateBps: 1800,
  sellerStateCode: "27",
  placeOfSupplyStateCode: "29",
});
// → { supplyType: "inter-state", taxablePaise: 42288,
//     igstPaise: 7612, totalPaise: 49900 }`;

export const FAQS = [
  {
    question: "What exactly do I get?",
    answer:
      "The full Next.js source code: auth with OTP, Razorpay billing, GST invoices, admin, emails, tests, a Dockerfile and a step-by-step README. You own the code and can use it for your products.",
  },
  {
    question: "Do I need a Razorpay account to start?",
    answer:
      "No. Everything runs locally with test-mode keys or the built-in offline payment simulator. You need an activated Razorpay account only when you go live.",
  },
  {
    question: "Are the invoices GST-compliant?",
    answer:
      "Invoices include the fields required by CGST Rule 46: GSTINs, place of supply, SAC code, tax breakup, a 16-character serial number that resets every financial year, and the total in words. The kit is a tool, not tax advice, so please have your CA review your configuration.",
  },
  {
    question: "Why does SMS OTP need DLT registration?",
    answer:
      "TRAI requires every commercial SMS in India to use a DLT-registered sender ID and template. Registration can take a few days, so the kit logs OTPs to the console in development and the README walks you through MSG91 DLT setup.",
  },
  {
    question: "Can I use Cashfree or another provider?",
    answer:
      "Yes. Payments, OTP and email each sit behind a small adapter interface. Add a provider by implementing the interface; the rest of the app doesn't change.",
  },
  {
    question: "Where can I deploy it?",
    answer:
      "Vercel + Neon is documented end to end, and a production Dockerfile is included for any VPS, Railway, Render or Fly.io. Supabase Postgres works too.",
  },
  {
    question: "Is there a refund policy?",
    answer:
      "Pre-orders are fully refundable until the kit ships. After delivery, you can request a refund within 7 days if the kit doesn't work as described.",
  },
] as const;
