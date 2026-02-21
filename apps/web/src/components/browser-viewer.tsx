"use client";

import { useState, useMemo } from "react";
import { Monitor, Globe, ChevronDown, Plus, X, Image as ImageIcon, AppWindow } from "lucide-react";
import { useAgent } from "./agent-provider";
import { NoVncCanvas } from "./novnc-canvas";
import type { BrowserInfo } from "@world-tester/shared";

type ViewMode = "live" | "screenshots";

const VNC_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_VNC_WS_URL ?? `ws://${window.location.hostname}:5901`
    : "ws://localhost:5901";

export function BrowserViewer() {
  const { status, browserState, sendCommand } = useAgent();
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [vncConnected, setVncConnected] = useState(false);
  const [showBrowserMenu, setShowBrowserMenu] = useState(false);

  const activeBrowser = useMemo(() => {
    if (!browserState) return null;
    return browserState.browsers.find((b) => b.isActive) ?? browserState.browsers[0] ?? null;
  }, [browserState]);

  const activeUrl = browserState?.activeUrl ?? "about:blank";
  const shortUrl = activeUrl.length > 60 ? activeUrl.slice(0, 57) + "..." : activeUrl;

  const handleTabClick = (browser: BrowserInfo, tabIdx: number) => {
    if (!browser.isActive) {
      sendCommand(`browser:switch ${browser.name}`);
    }
    if (tabIdx !== browser.activeTabIndex) {
      sendCommand(`tab:switch ${tabIdx}`);
    }
  };

  const handleNewTab = () => {
    sendCommand("tab:new");
  };

  const handleCloseTab = (index: number) => {
    sendCommand(`tab:close ${index}`);
  };

  if (status !== "connected") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Browser View</span>
        </div>
        <div className="flex flex-1 items-center justify-center bg-black/20 text-muted-foreground text-sm">
          <div className="text-center space-y-2">
            <Monitor className="mx-auto h-12 w-12 opacity-20" />
            <p>Start the agent server to see the browser view</p>
            <code className="text-xs opacity-60">npm run agent:server</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar — Browser instance selector + view mode */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        {/* Browser instance selector — always visible */}
        <div className="relative flex items-center gap-1.5">
          <AppWindow className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => setShowBrowserMenu(!showBrowserMenu)}
          >
            <span className="font-medium text-foreground">{activeBrowser?.name ?? "main"}</span>
            {browserState && browserState.browsers.length > 1 && (
              <span className="rounded-full bg-muted px-1 text-[9px]">{browserState.browsers.length}</span>
            )}
            <ChevronDown className="h-3 w-3" />
          </button>
          {showBrowserMenu && (
            <div className="absolute top-full left-0 z-10 mt-1 min-w-[160px] rounded-md border border-border bg-card py-1 shadow-lg">
              <div className="px-3 py-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Browser Instances
              </div>
              {browserState?.browsers.map((b) => (
                <button
                  key={b.name}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent ${
                    b.isActive ? "text-foreground" : "text-muted-foreground"
                  }`}
                  onClick={() => {
                    sendCommand(`browser:switch ${b.name}`);
                    setShowBrowserMenu(false);
                  }}
                >
                  <AppWindow className="h-3 w-3" />
                  <span>{b.name}</span>
                  <span className="ml-auto text-[9px] text-muted-foreground">{b.tabs.length} tab{b.tabs.length !== 1 ? "s" : ""}</span>
                  {b.isActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* View mode toggle */}
        <div className="ml-auto flex items-center gap-1">
          <button
            className={`rounded px-1.5 py-0.5 text-[10px] ${viewMode === "live" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setViewMode("live")}
          >
            Live
          </button>
          <button
            className={`rounded px-1.5 py-0.5 text-[10px] ${viewMode === "screenshots" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setViewMode("screenshots")}
          >
            <ImageIcon className="inline h-3 w-3 mr-0.5" />
            Screenshots
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{shortUrl}</span>
        </div>
      </div>

      {/* Tab bar — tabs within the active browser instance */}
      {activeBrowser && activeBrowser.tabs.length > 0 && (
        <div className="flex items-center gap-px border-b border-border bg-card/50 px-1 overflow-x-auto">
          {activeBrowser.tabs.map((tab, idx) => {
            const isActive = idx === activeBrowser.activeTabIndex;
            const label = tab.url
              ? (tab.url.length > 30 ? tab.url.slice(0, 27) + "..." : tab.url)
              : "New Tab";
            return (
              <div
                key={idx}
                className={`group flex items-center gap-1.5 px-2.5 py-1 text-[10px] cursor-pointer border-b-2 ${
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => handleTabClick(activeBrowser, idx)}
              >
                <span className="rounded bg-muted px-1 py-px text-[8px] font-mono text-muted-foreground">{idx}</span>
                <span className="max-w-[120px] truncate">{label}</span>
                {activeBrowser.tabs.length > 1 && (
                  <button
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(idx);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
          <button
            className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
            onClick={handleNewTab}
            title="Open a new tab in this browser"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Content — aspect-ratio matches the Xvfb display so noVNC fills perfectly */}
      <div className="flex-1 bg-black relative overflow-hidden flex items-center justify-center">
        {viewMode === "live" ? (
          <div className="relative w-full h-full max-h-full" style={{ aspectRatio: "1288 / 711", maxWidth: "100%" }}>
            <NoVncCanvas
              url={VNC_WS_URL}
              onConnect={() => setVncConnected(true)}
              onDisconnect={() => setVncConnected(false)}
            />
            {!vncConnected && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-muted-foreground text-xs z-10">
                <div className="text-center space-y-2">
                  <Monitor className="mx-auto h-8 w-8 opacity-30" />
                  <p>Connecting to VNC...</p>
                  <p className="opacity-50">Make sure VNC is enabled (VNC=true)</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full">
            <ScreenshotTimeline />
          </div>
        )}
      </div>
    </div>
  );
}

function ScreenshotTimeline() {
  const { onMessage } = useAgent();
  const [screenshots, setScreenshots] = useState<Array<{ label: string; path: string; timestamp: string }>>([]);
  const [selected, setSelected] = useState<number | null>(null);

  // Collect screenshot events
  useState(() => {
    return onMessage((msg) => {
      if (msg.type === "screenshot") {
        const payload = msg.payload as { label: string; path: string; timestamp: string };
        setScreenshots((prev) => [...prev, payload]);
      }
    });
  });

  if (screenshots.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
        <div className="text-center space-y-2">
          <ImageIcon className="mx-auto h-8 w-8 opacity-20" />
          <p>No screenshots captured yet</p>
          <p className="opacity-50">Screenshots appear during test runs</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {selected !== null && screenshots[selected] && (
        <div className="flex-1 flex items-center justify-center p-2" onClick={() => setSelected(null)}>
          <img
            src={`/api/screenshots/${encodeURIComponent(screenshots[selected].path)}`}
            alt={screenshots[selected].label}
            className="max-h-full max-w-full object-contain rounded"
          />
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto border-t border-border p-2">
        {screenshots.map((ss, idx) => (
          <button
            key={idx}
            className={`flex-shrink-0 rounded border p-0.5 ${
              selected === idx ? "border-primary" : "border-border hover:border-muted-foreground"
            }`}
            onClick={() => setSelected(idx)}
          >
            <div className="h-12 w-20 bg-muted rounded flex items-center justify-center">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-[8px] text-muted-foreground truncate max-w-[80px] mt-0.5">
              {ss.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
