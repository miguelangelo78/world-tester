"use client";

import React, { useState } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { NoVncCanvas } from "./novnc-canvas";

interface E2EBrowserViewerProps {
  onClose?: () => void;
}

const VNC_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_VNC_WS_URL ?? `ws://${window.location.hostname}:5901`
    : "ws://localhost:5901";

export const E2EBrowserViewer: React.FC<E2EBrowserViewerProps> = ({ onClose }) => {
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [vncConnected, setVncConnected] = useState(false);

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-background" : "border border-border rounded-lg overflow-hidden bg-card"}>
      <div className="flex items-center justify-between bg-muted border-b border-border p-3">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${vncConnected ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
          <span className="text-sm font-medium text-foreground">Live Browser</span>
          <span className="text-xs text-muted-foreground ml-2">
            {vncConnected ? "Connected" : "Connecting..."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="relative w-full bg-background" style={{ height: isFullscreen ? "calc(100vh - 60px)" : "500px" }}>
        <NoVncCanvas
          url={VNC_WS_URL}
          onConnect={() => setVncConnected(true)}
          onDisconnect={() => setVncConnected(false)}
        />
        {!vncConnected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center text-muted-foreground">
              <p className="mb-2">Connecting to browser...</p>
              <p className="text-sm">The browser will appear once the test starts navigating</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default E2EBrowserViewer;
