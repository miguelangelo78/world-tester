"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Terminal,
  History,
  FileText,
  Brain,
  Settings,
  Bug,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgent } from "./agent-provider";

const navItems = [
  { href: "/", label: "Dashboard", icon: Terminal },
  { href: "/history", label: "History", icon: History },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/knowledge", label: "Knowledge", icon: Brain },
  { href: "/settings", label: "Settings", icon: Settings },
];

const SIDEBAR_KEY = "wt-sidebar-collapsed";

interface SidebarContextValue {
  collapsed: boolean;
  mobileOpen: boolean;
  toggle: () => void;
  toggleMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  mobileOpen: false,
  toggle: () => {},
  toggleMobile: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "true");
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!mounted) return <>{children}</>;

  return (
    <SidebarContext.Provider value={{ collapsed, mobileOpen, toggle, toggleMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function MobileMenuButton() {
  const { toggleMobile } = useSidebar();
  return (
    <button
      onClick={toggleMobile}
      className="md:hidden rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
      aria-label="Toggle menu"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { status } = useAgent();
  const { collapsed, mobileOpen, toggle, toggleMobile } = useSidebar();

  const sidebarContent = (
    <>
      <div className={cn(
        "flex border-b border-border",
        collapsed
          ? "flex-col items-center gap-1 px-1 py-2"
          : "items-center justify-between px-3 py-3",
      )}>
        <div className={cn(
          "flex items-center overflow-hidden",
          collapsed ? "justify-center" : "gap-2",
        )}>
          <Bug className="h-5 w-5 shrink-0 text-primary" />
          {!collapsed && (
            <span className="text-sm font-bold tracking-tight whitespace-nowrap">World Tester</span>
          )}
        </div>
        <button
          onClick={toggle}
          className="hidden md:flex shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-3">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                collapsed && "justify-center px-2",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground space-y-1">
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              status === "connected" ? "bg-success" : status === "connecting" ? "bg-warning animate-pulse" : "bg-destructive",
            )}
          />
          {!collapsed && (
            <span>{status === "connected" ? "Agent connected" : status === "connecting" ? "Connecting..." : "Disconnected"}</span>
          )}
        </div>
        {!collapsed && <div>v0.1.0</div>}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-card transition-all duration-200",
          collapsed ? "w-14" : "w-56",
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={toggleMobile}
          />
          <aside className="relative z-50 flex w-64 h-full flex-col bg-card border-r border-border shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-3">
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-primary" />
                <span className="text-sm font-bold tracking-tight">World Tester</span>
              </div>
              <button
                onClick={toggleMobile}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-2 py-3">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    status === "connected" ? "bg-success" : status === "connecting" ? "bg-warning animate-pulse" : "bg-destructive",
                  )}
                />
                <span>{status === "connected" ? "Agent connected" : status === "connecting" ? "Connecting..." : "Disconnected"}</span>
              </div>
              <div>v0.1.0</div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
