"use client";

import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { changePlanAction } from "../actions";
import { CheckoutButton } from "./checkout-button";

export type PlanOption = {
  key: string;
  name: string;
  description: string;
  features: string[];
  highlighted: boolean;
  prices: { monthly: string | null; yearly: string | null };
};

type Props = {
  plans: PlanOption[];
  current: { planKey: string; interval: "monthly" | "yearly" } | null;
  canCheckout: boolean;
  themeColor: string;
};

export function PlanPicker({ plans, current, canCheckout, themeColor }: Props) {
  const router = useRouter();
  const [interval, setInterval] = useState<"monthly" | "yearly">(current?.interval ?? "monthly");
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  async function switchTo(planKey: string) {
    setSwitching(planKey);
    setMessage(null);
    const result = await changePlanAction({ planKey, interval });
    setSwitching(null);
    setMessage(result.ok ? { type: "ok", text: result.data.message } : { type: "error", text: result.error.message });
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Billing interval">
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={interval === option}
            onClick={() => setInterval(option)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              interval === option ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {option === "monthly" ? "Monthly" : "Yearly"}
            {option === "yearly" ? <span className="ml-1 text-xs text-primary">2 months free</span> : null}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const price = plan.prices[interval];
          const isCurrent = current?.planKey === plan.key && current.interval === interval;
          return (
            <div
              key={plan.key}
              className={cn("flex flex-col rounded-xl border p-5", plan.highlighted && "border-primary")}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{plan.name}</h3>
                {isCurrent ? (
                  <Badge>Current plan</Badge>
                ) : plan.highlighted ? (
                  <Badge variant="secondary">Popular</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
              <p className="mt-4">
                <span className="text-3xl font-bold">{price ?? "—"}</span>
                <span className="ml-1 text-sm text-muted-foreground">
                  /{interval === "monthly" ? "month" : "year"} incl. GST
                </span>
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {!price ? null : isCurrent ? (
                  <Button className="w-full" variant="outline" disabled>
                    Current plan
                  </Button>
                ) : current ? (
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={switching !== null}
                    onClick={() => void switchTo(plan.key)}
                  >
                    {switching === plan.key ? "Switching…" : `Switch to ${plan.name}`}
                  </Button>
                ) : (
                  <CheckoutButton
                    request={{ kind: "subscription", planKey: plan.key, interval }}
                    label={`Subscribe to ${plan.name}`}
                    themeColor={themeColor}
                    variant={plan.highlighted ? "default" : "outline"}
                    disabled={!canCheckout}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {message ? (
        <p
          role={message.type === "ok" ? "status" : "alert"}
          className={message.type === "ok" ? "text-sm text-success" : "text-sm text-destructive"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
