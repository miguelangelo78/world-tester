"use client";

import { useState } from "react";
import { DollarSign, ChevronDown, Coins } from "lucide-react";
import { useAgent } from "./agent-provider";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function CostBadge() {
  const { cost } = useAgent();
  const [open, setOpen] = useState(false);

  const session = cost?.session;
  const billing = cost?.billing;

  const sessionCost = session?.costUsd ?? 0;
  const billingCost = billing?.costUsd ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md bg-muted px-2 sm:px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
      >
        <DollarSign className="h-3 w-3" />
        <span>${sessionCost.toFixed(4)}</span>
        <span className="hidden sm:inline text-border">|</span>
        <span className="hidden sm:inline">${billingCost.toFixed(4)}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card p-3 shadow-xl text-xs space-y-3">
            <div>
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium mb-1.5">
                <Coins className="h-3 w-3" />
                <span>This Session</span>
              </div>
              <div className="grid grid-cols-2 gap-y-0.5 pl-5">
                <span className="text-muted-foreground">Cost</span>
                <span className="text-right text-emerald-400 font-medium">${sessionCost.toFixed(4)}</span>
                <span className="text-muted-foreground">Input tokens</span>
                <span className="text-right">{fmtTokens(session?.inputTokens ?? 0)}</span>
                <span className="text-muted-foreground">Output tokens</span>
                <span className="text-right">{fmtTokens(session?.outputTokens ?? 0)}</span>
              </div>
            </div>

            <hr className="border-border" />

            <div>
              <div className="flex items-center gap-1.5 text-muted-foreground font-medium mb-1.5">
                <DollarSign className="h-3 w-3" />
                <span>Billing Cycle</span>
                {billing?.cycleStart && (
                  <span className="ml-auto text-[9px] text-muted-foreground/60">
                    since {new Date(billing.cycleStart).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-y-0.5 pl-5">
                <span className="text-muted-foreground">Total cost</span>
                <span className="text-right text-emerald-400 font-medium">${billingCost.toFixed(4)}</span>
                <span className="text-muted-foreground">Input tokens</span>
                <span className="text-right">{fmtTokens(billing?.inputTokens ?? 0)}</span>
                <span className="text-muted-foreground">Output tokens</span>
                <span className="text-right">{fmtTokens(billing?.outputTokens ?? 0)}</span>
                <span className="text-muted-foreground">Sessions</span>
                <span className="text-right">{billing?.sessionCount ?? 0}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
