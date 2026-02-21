"use client";

import { AgentProvider } from "./agent-provider";
import { SidebarProvider, Sidebar } from "./sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AgentProvider>
      <SidebarProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto min-w-0">{children}</main>
        </div>
      </SidebarProvider>
    </AgentProvider>
  );
}
