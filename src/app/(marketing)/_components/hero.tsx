import { ArrowRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import { clientEnv } from "@/env/client";
import { formatINR } from "@/lib/money";
import { KIT_TIERS } from "../_content";

const BADGES = ["Razorpay + UPI AutoPay", "GST invoices", "+91 OTP login", "DPDP-ready"];

export function Hero() {
  const startingAt = [...KIT_TIERS].sort((a, b) => a.price - b.price)[0]?.price;
  return (
    <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 pt-20 pb-16 text-center md:pt-28">
      <Badge variant="secondary" className="rounded-full px-3 py-1">
        Pre-orders open · launch pricing
      </Badge>
      <h1 className="text-4xl font-bold tracking-tight text-balance md:text-6xl">
        Launch your Indian SaaS <span className="text-primary">this weekend</span>
      </h1>
      <p className="max-w-2xl text-lg text-balance text-muted-foreground md:text-xl">{site.brand.description}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg">
          <a href={clientEnv.preorderUrl ?? "#waitlist"}>
            Pre-order{startingAt ? ` from ${formatINR(startingAt, { showPaise: false })}` : ""}
            <ArrowRightIcon />
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="#waitlist">Join the waitlist</a>
        </Button>
      </div>
      <ul
        className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
        aria-label="Highlights"
      >
        {BADGES.map((badge) => (
          <li key={badge} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            {badge}
          </li>
        ))}
      </ul>
    </section>
  );
}
