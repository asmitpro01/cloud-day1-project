import { Badge } from "@/components/ui/badge";

const LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  created: { label: "Awaiting payment", variant: "outline" },
  authenticated: { label: "Activating", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  pending: { label: "Payment retrying", variant: "destructive" },
  halted: { label: "Payment failed", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  completed: { label: "Completed", variant: "outline" },
  paused: { label: "Paused", variant: "secondary" },
  expired: { label: "Expired", variant: "outline" },
  captured: { label: "Paid", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  refunded: { label: "Refunded", variant: "secondary" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = LABELS[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
