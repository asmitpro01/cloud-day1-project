import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clientEnv } from "@/env/client";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { KIT_TIERS } from "../_content";

export function Pricing() {
  const href = clientEnv.preorderUrl ?? "#waitlist";
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight">Simple, one-time pricing</h2>
        <p className="mt-3 text-lg text-muted-foreground">Pay once in ₹, own the code. GST invoice included.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {KIT_TIERS.map((tier) => (
          <div
            key={tier.key}
            className={cn(
              "flex flex-col rounded-xl border bg-card p-6",
              tier.highlighted && "border-primary ring-1 ring-primary",
            )}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{tier.name}</h3>
              {tier.highlighted ? <Badge>Most popular</Badge> : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{tier.description}</p>
            <p className="mt-6">
              <span className="text-4xl font-bold tracking-tight">{formatINR(tier.price, { showPaise: false })}</span>
              <span className="ml-2 text-sm text-muted-foreground">one-time, incl. GST</span>
            </p>
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {feature}
                </li>
              ))}
            </ul>
            <Button asChild className="mt-8" variant={tier.highlighted ? "default" : "outline"}>
              <a href={href}>Pre-order {tier.name}</a>
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Secure payment by Razorpay: UPI, cards, net banking and wallets.
      </p>
    </section>
  );
}
