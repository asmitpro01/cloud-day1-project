import "server-only";
import { site } from "@/config/site";
import { chargeAmountFor } from "@/lib/gst/tax";
import type { Paise } from "@/lib/money";

/** What Razorpay charges for a list price, honouring `site.gst.pricingMode` (inclusive or + GST). */
export function chargeAmountPaise(listPrice: Paise): Paise {
  return chargeAmountFor(listPrice, site.gst.pricingMode, site.gst.rateBps);
}

/** Suffix shown next to prices: "incl. GST" or "+ GST". */
export function priceTaxLabel(): string {
  return site.gst.pricingMode === "inclusive" ? "incl. GST" : "+ GST";
}
