"use client";

import { useEffect, useState, useCallback } from "react";
import { History, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { useAgent } from "./agent-provider";
import { PageHeader } from "./page-header";
import type { WSMessage } from "@world-tester/shared";

interface TaskEntry {
  id: string;
  timestamp: string;
  command: string;
  instruction: string;
  mode: string;
  domain?: string;
  outcome: string;
  result?: string;
  duration_ms: number;
  cost_usd: number;
}

const outcomeIcon: Record<string, typeof CheckCircle2> = {
  pass: CheckCircle2,
  fail: XCircle,
  blocked: AlertTriangle,
  partial: AlertTriangle,
};

const outcomeColor: Record<string, string> = {
  pass: "text-success",
  fail: "text-destructive",
  blocked: "text-warning",
  partial: "text-warning",
};

export function HistoryView() {
  const { status, sendCommand, onMessage } = useAgent();
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(() => {
    if (status !== "connected") return;
    setLoading(true);
    const id = sendCommand("history");

    const unsub = onMessage((msg: WSMessage) => {
      if (msg.id === id && msg.type === "command_result") {
        try {
          const data = JSON.parse((msg.payload as { message: string }).message);
          setTasks(Array.isArray(data) ? data : []);
        } catch {
          setTasks([]);
        }
        setLoading(false);
        unsub();
      }
    });
  }, [status, sendCommand, onMessage]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        left={
          <>
            <History className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">Task History</h1>
          </>
        }
        right={
          <button
            onClick={fetchHistory}
            disabled={status !== "connected" || loading}
            className="rounded-md bg-accent px-3 py-1 text-xs text-accent-foreground hover:bg-accent/80 disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {status !== "connected" ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Connect to the agent to view task history.
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Loading history...
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            No task history yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {tasks.map((task) => {
              const Icon = outcomeIcon[task.outcome] ?? Clock;
              const color = outcomeColor[task.outcome] ?? "text-muted-foreground";
              return (
                <div key={task.id} className="px-4 py-3 hover:bg-accent/30">
                  <div className="flex items-start gap-3">
                    <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground uppercase">
                          {task.mode}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(task.timestamp).toLocaleString()}
                        </span>
                        {task.domain && (
                          <span className="hidden sm:inline text-xs text-muted-foreground opacity-60">
                            {task.domain}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm truncate">{task.instruction}</p>
                      {task.result && (
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {task.result}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{(task.duration_ms / 1000).toFixed(1)}s</span>
                        <span>${task.cost_usd.toFixed(4)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
