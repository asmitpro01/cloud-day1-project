import {
  IndianRupeeIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  RepeatIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
} from "lucide-react";
import { FEATURES } from "../_content";

const ICONS = {
  repeat: RepeatIcon,
  receipt: ReceiptTextIcon,
  smartphone: SmartphoneIcon,
  rupee: IndianRupeeIcon,
  shield: ShieldCheckIcon,
  dashboard: LayoutDashboardIcon,
} as const;

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight">Everything Stripe-first kits skip</h2>
        <p className="mt-3 text-lg text-muted-foreground">
          Built for customers who pay with UPI, need GST invoices and log in with a phone number.
        </p>
      </div>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = ICONS[feature.icon];
          return (
            <li key={feature.title} className="rounded-xl border bg-card p-6">
              <Icon className="mb-4 size-6 text-primary" aria-hidden />
              <h3 className="font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
