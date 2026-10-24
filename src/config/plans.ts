import { z } from "zod";
import { rupees, type Paise } from "@/lib/money";

/**
 * ★ Plans and prices for YOUR SaaS (the demo app's billing). Edit, then run `pnpm plans:sync`
 * to create matching Razorpay plans. Prices are integer paise; `rupees(499)` is ₹499.00.
 * With `site.gst.pricingMode = "inclusive"` these prices already include GST.
 */

/** Everything a plan can unlock. `hasAccess(userId, feature)` checks against these keys. */
export const FEATURES = {
  "projects.create": "Create projects",
  "projects.unlimited": "Unlimited projects",
  "reports.export": "Export reports",
  "team.invite": "Invite teammates",
  "support.priority": "Priority support",
} as const;

export type Feature = keyof typeof FEATURES;
export type BillingInterval = "monthly" | "yearly";
export const BILLING_INTERVALS: readonly BillingInterval[] = ["monthly", "yearly"];

type PlanDefinition = {
  key: string;
  name: string;
  description: string;
  features: readonly Feature[];
  prices: Partial<Record<BillingInterval, Paise>>;
  highlighted?: boolean;
};

type ProductDefinition = {
  key: string;
  name: string;
  description: string;
  features: readonly Feature[];
  price: Paise;
};

const PLAN_DEFINITIONS = [
  {
    key: "free",
    name: "Free",
    description: "Kick the tyres. No card needed.",
    features: ["projects.create"],
    prices: {},
  },
  {
    key: "pro",
    name: "Pro",
    description: "For solo founders shipping fast.",
    features: ["projects.create", "projects.unlimited", "reports.export"],
    prices: { monthly: rupees(499), yearly: rupees(4990) },
    highlighted: true,
  },
  {
    key: "business",
    name: "Business",
    description: "For small teams that need more.",
    features: ["projects.create", "projects.unlimited", "reports.export", "team.invite", "support.priority"],
    prices: { monthly: rupees(1499), yearly: rupees(14990) },
  },
] as const satisfies readonly PlanDefinition[];

/** One-time purchases, paid through Razorpay Orders. */
const PRODUCT_DEFINITIONS = [
  {
    key: "lifetime",
    name: "Lifetime Pro",
    description: "Every Pro feature, forever. One payment.",
    features: ["projects.create", "projects.unlimited", "reports.export"],
    price: rupees(9999),
  },
] as const satisfies readonly ProductDefinition[];

export type PlanKey = (typeof PLAN_DEFINITIONS)[number]["key"];
export type ProductKey = (typeof PRODUCT_DEFINITIONS)[number]["key"];
export type Plan = PlanDefinition & { key: PlanKey };
export type Product = ProductDefinition & { key: ProductKey };

export const FREE_PLAN_KEY: PlanKey = "free";

// Razorpay's minimum charge is ₹1.00.
const MIN_AMOUNT_PAISE = 100;

const catalogSchema = z
  .object({
    plans: z.array(
      z.object({
        key: z.string().regex(/^[a-z0-9-]+$/),
        prices: z.record(z.string(), z.number().int().min(MIN_AMOUNT_PAISE)),
        features: z.array(z.string()),
      }),
    ),
    products: z.array(
      z.object({ key: z.string().regex(/^[a-z0-9-]+$/), price: z.number().int().min(MIN_AMOUNT_PAISE) }),
    ),
  })
  .superRefine((catalog, ctx) => {
    const keys = [...catalog.plans.map((plan) => plan.key), ...catalog.products.map((product) => product.key)];
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "Plan and product keys must be unique" });
    }
    if (!catalog.plans.some((plan) => plan.key === FREE_PLAN_KEY && Object.keys(plan.prices).length === 0)) {
      ctx.addIssue({ code: "custom", message: `A free plan with key "${FREE_PLAN_KEY}" and no prices is required` });
    }
  });

catalogSchema.parse({ plans: PLAN_DEFINITIONS, products: PRODUCT_DEFINITIONS });

export const PLANS: readonly Plan[] = PLAN_DEFINITIONS;
export const PRODUCTS: readonly Product[] = PRODUCT_DEFINITIONS;

export function isPlanKey(value: string): value is PlanKey {
  return PLANS.some((plan) => plan.key === value);
}

export function isProductKey(value: string): value is ProductKey {
  return PRODUCTS.some((product) => product.key === value);
}

export function getPlan(key: PlanKey): Plan {
  const plan = PLANS.find((candidate) => candidate.key === key);
  if (!plan) throw new RangeError(`Unknown plan ${key}`);
  return plan;
}

export function getProduct(key: ProductKey): Product {
  const product = PRODUCTS.find((candidate) => candidate.key === key);
  if (!product) throw new RangeError(`Unknown product ${key}`);
  return product;
}

/** The price of a plan for an interval, or `null` when the plan isn't sold that way. */
export function getPlanPrice(key: PlanKey, interval: BillingInterval): Paise | null {
  return getPlan(key).prices[interval] ?? null;
}

/** Paid plans with at least one price, in display order. */
export function paidPlans(): Plan[] {
  return PLANS.filter((plan) => Object.keys(plan.prices).length > 0);
}
