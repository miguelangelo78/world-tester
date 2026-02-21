"use client";

import { DollarSign } from "lucide-react";
import { useAgent } from "./agent-provider";

export function CostBadge() {
  const { cost } = useAgent();

  const sessionCost = cost?.session.costUsd ?? 0;
  const billingCost = cost?.billing.costUsd ?? 0;

  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 sm:px-2.5 py-1 text-xs text-muted-foreground">
      <DollarSign className="h-3 w-3" />
      <span>${sessionCost.toFixed(4)}</span>
      <span className="hidden sm:inline text-border">|</span>
      <span className="hidden sm:inline">Cycle: ${billingCost.toFixed(4)}</span>
    </div>
  );
}
