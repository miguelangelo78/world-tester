"use client";

import { useEffect, useRef, useState } from "react";

interface NoVncCanvasProps {
  url: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function NoVncCanvas({ url, onConnect, onDisconnect }: NoVncCanvasProps) {
  const vncTargetRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"waiting" | "connected" | "error">("waiting");

  useEffect(() => {
    const target = vncTargetRef.current;
    if (!target || !url) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 2000;
    const MAX_DELAY = 15000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rfb: any = null;
    let intentionalDisconnect = false;

    function destroyRfb() {
      if (!rfb) return;
      intentionalDisconnect = true;
      try { rfb.disconnect(); } catch { /* already disconnected */ }
      rfb = null;
      if (target) target.innerHTML = "";
    }

    async function connect() {
      if (cancelled || !target) return;

      destroyRfb();
      intentionalDisconnect = false;

      try {
        const { default: RFB } = await import("novnc-next");
        if (cancelled) return;

        rfb = new RFB(target, url, {
          wsProtocols: ["binary"],
        });

        rfb.viewOnly = false;
        rfb.scaleViewport = true;
        rfb.clipViewport = true;
        rfb.resizeSession = false;
        rfb.showDotCursor = false;
        rfb.background = "#09090b";

        rfb.addEventListener("connect", () => {
          if (cancelled) return;
          retryDelay = 2000;
          setStatus("connected");
          onConnect?.();
        });

        rfb.addEventListener("disconnect", () => {
          rfb = null;
          if (cancelled || intentionalDisconnect) return;
          setStatus("waiting");
          onDisconnect?.();
          retryTimer = setTimeout(() => {
            if (!cancelled) connect();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 1.5, MAX_DELAY);
        });

        rfb.addEventListener("securityfailure", () => {
          if (!cancelled) setStatus("error");
        });
      } catch {
        if (!cancelled) {
          setStatus("waiting");
          retryTimer = setTimeout(() => {
            if (!cancelled) connect();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 1.5, MAX_DELAY);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      destroyRfb();
      onDisconnect?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div className="relative h-full w-full">
      {/* Dedicated div for noVNC — React never touches its children */}
      <div ref={vncTargetRef} className="absolute inset-0" />
      {status !== "connected" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs text-muted-foreground z-10">
          {status === "error"
            ? "VNC authentication failed"
            : "Waiting for browser..."}
        </div>
      )}
    </div>
  );
}
