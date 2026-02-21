"use client";

import { Settings, Server, DollarSign, Database } from "lucide-react";
import { useAgent } from "./agent-provider";
import { PageHeader } from "./page-header";

export function SettingsView() {
  const { status, cost } = useAgent();

  const billingCost = cost?.billing.costUsd ?? 0;
  const sessionCount = cost?.billing.sessionCount ?? 0;
  const sessionCost = cost?.session.costUsd ?? 0;
  const sessionIn = cost?.session.inputTokens ?? 0;
  const sessionOut = cost?.session.outputTokens ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        left={
          <>
            <Settings className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">Settings</h1>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 max-w-xl">
        {/* Connection */}
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-xs font-medium">
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
            Agent Connection
          </h2>
          <div className="rounded-lg border border-border p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={status === "connected" ? "text-success" : "text-destructive"}>
                {status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">WebSocket URL</span>
              <span className="font-mono text-[10px]">
                {typeof window !== "undefined"
                  ? process.env.NEXT_PUBLIC_AGENT_WS_URL ?? `ws://${window.location.hostname}:3100`
                  : "ws://localhost:3100"}
              </span>
            </div>
          </div>
        </section>

        {/* Cost & Billing */}
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-xs font-medium">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
            Cost & Billing
          </h2>
          <div className="rounded-lg border border-border p-3 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session cost</span>
              <span>${sessionCost.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session tokens</span>
              <span>{sessionIn.toLocaleString()} in / {sessionOut.toLocaleString()} out</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between">
              <span className="text-muted-foreground">Billing cycle total</span>
              <span>${billingCost.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session count</span>
              <span>{sessionCount}</span>
            </div>
          </div>
        </section>

        {/* Environment */}
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-xs font-medium">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            Environment
          </h2>
          <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
            Configuration is managed via <code className="bg-accent px-1 rounded">.env</code> in the project root.
            Restart the agent server after changes.
          </div>
        </section>
      </div>
    </div>
  );
}
