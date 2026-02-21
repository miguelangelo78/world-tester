"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAgentSocket, type AgentSocket } from "@/hooks/use-agent-socket";

const AgentContext = createContext<AgentSocket | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const socket = useAgentSocket();
  return <AgentContext.Provider value={socket}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentSocket {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}
