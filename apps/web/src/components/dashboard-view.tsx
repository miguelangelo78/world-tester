"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Rows2,
  Columns2,
  Monitor,
  TerminalSquare,
  PanelBottomOpen,
  GripHorizontal,
  Minimize2,
  ArrowLeftRight,
} from "lucide-react";
import { CommandTerminal } from "./command-terminal";
import { BrowserViewer } from "./browser-viewer";
import { CostBadge } from "./cost-badge";
import { MobileMenuButton } from "./sidebar";

type Layout = "vertical" | "horizontal" | "browser" | "terminal" | "floating";

const STORAGE_KEY = "wt-dashboard-layout";
const FLIP_KEY = "wt-dashboard-flipped";

const LAYOUTS: { id: Layout; icon: typeof Rows2; label: string; shortcut: string }[] = [
  { id: "vertical", icon: Rows2, label: "Vertical split", shortcut: "Alt+1" },
  { id: "horizontal", icon: Columns2, label: "Horizontal split", shortcut: "Alt+2" },
  { id: "browser", icon: Monitor, label: "Browser only", shortcut: "Alt+3" },
  { id: "terminal", icon: TerminalSquare, label: "Terminal only", shortcut: "Alt+4" },
  { id: "floating", icon: PanelBottomOpen, label: "Floating terminal", shortcut: "Alt+5" },
];

function loadLayout(): Layout {
  if (typeof window === "undefined") return "vertical";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && LAYOUTS.some((l) => l.id === saved)) return saved as Layout;
  return "vertical";
}

function ResizeHandle({ direction }: { direction: "vertical" | "horizontal" }) {
  const isVertical = direction === "vertical";
  return (
    <Separator
      className={`group relative flex items-center justify-center bg-border/50 hover:bg-primary/20 transition-colors ${
        isVertical ? "h-1.5" : "w-1.5"
      }`}
    >
      <div
        className={`rounded-full bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors ${
          isVertical ? "h-0.5 w-8" : "h-8 w-0.5"
        }`}
      />
    </Separator>
  );
}

function FloatingTerminal({ onMinimize }: { onMinimize: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 640) {
      return { w: Math.min(360, window.innerWidth - 32), h: 260 };
    }
    return { w: 480, h: 320 };
  });
  const [pos, setPos] = useState({ x: -1, y: -1 });
  const dragging = useRef(false);
  const resizing = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (pos.x === -1 && panelRef.current) {
      const parent = panelRef.current.parentElement;
      if (parent) {
        const r = parent.getBoundingClientRect();
        setPos({ x: r.width - size.w - 16, y: r.height - size.h - 16 });
      }
    }
  }, [pos.x, size.w, size.h]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, mode: "drag" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      if (mode === "drag") {
        dragging.current = true;
        offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      } else {
        resizing.current = true;
        offset.current = { x: e.clientX, y: e.clientY };
      }

      const startSize = { ...size };
      const startPos = { ...pos };

      const onMove = (ev: PointerEvent) => {
        if (dragging.current) {
          setPos({ x: ev.clientX - offset.current.x, y: ev.clientY - offset.current.y });
        }
        if (resizing.current) {
          const dw = ev.clientX - offset.current.x;
          const dh = ev.clientY - offset.current.y;
          setSize({
            w: Math.max(280, startSize.w + dw),
            h: Math.max(180, startSize.h + dh),
          });
          setPos({
            x: startPos.x - dw,
            y: startPos.y - dh,
          });
        }
      };

      const onUp = () => {
        dragging.current = false;
        resizing.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [pos, size],
  );

  return (
    <div
      ref={panelRef}
      className="absolute z-20 rounded-lg border border-border bg-background shadow-2xl overflow-hidden flex flex-col"
      style={{
        width: size.w,
        height: size.h,
        left: pos.x >= 0 ? pos.x : undefined,
        top: pos.y >= 0 ? pos.y : undefined,
        right: pos.x < 0 ? 16 : undefined,
        bottom: pos.y < 0 ? 16 : undefined,
      }}
    >
      <div
        className="flex items-center justify-between px-2 py-1 border-b border-border bg-card/80 cursor-move select-none"
        onPointerDown={(e) => onPointerDown(e, "drag")}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <GripHorizontal className="h-3 w-3" />
          <span>Terminal</span>
        </div>
        <button
          onClick={onMinimize}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Minimize (switch to browser-only)"
        >
          <Minimize2 className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <CommandTerminal />
      </div>
      <div
        className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize"
        onPointerDown={(e) => onPointerDown(e, "resize")}
      />
    </div>
  );
}

export function DashboardView() {
  const [layout, setLayout] = useState<Layout>("vertical");
  const [flipped, setFlipped] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLayout(loadLayout());
    setFlipped(localStorage.getItem(FLIP_KEY) === "true");
    setMounted(true);
  }, []);

  const toggleFlip = useCallback(() => {
    setFlipped((prev) => {
      const next = !prev;
      localStorage.setItem(FLIP_KEY, String(next));
      return next;
    });
  }, []);

  const switchLayout = useCallback((l: Layout) => {
    setLayout(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const map: Record<string, Layout> = {
        "1": "vertical",
        "2": "horizontal",
        "3": "browser",
        "4": "terminal",
        "5": "floating",
      };
      const target = map[e.key];
      if (target) {
        e.preventDefault();
        switchLayout(target);
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFlip();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [switchLayout, toggleFlip]);

  if (!mounted) return null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-2 sm:px-4 py-1.5 gap-2">
        <div className="flex items-center gap-2">
          <MobileMenuButton />
          <h1 className="text-sm font-medium text-muted-foreground hidden sm:block">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {LAYOUTS.map((l) => {
              const Icon = l.icon;
              const active = layout === l.id;
              const mobileHidden = l.id === "horizontal" || l.id === "floating";
              return (
                <button
                  key={l.id}
                  onClick={() => switchLayout(l.id)}
                  title={`${l.label} (${l.shortcut})`}
                  className={`rounded p-1 transition-colors ${
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  } ${mobileHidden ? "hidden sm:block" : ""}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          {(layout === "vertical" || layout === "horizontal") && (
            <button
              onClick={toggleFlip}
              title={`Flip panels (Alt+F)`}
              className={`rounded p-1 transition-colors ${
                flipped
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>
          )}
          <CostBadge />
        </div>
      </header>

      <div className="flex-1 overflow-hidden relative">
        {(layout === "vertical" || layout === "horizontal") && (
          <Group
            key={`${layout}-${flipped}`}
            orientation={layout === "vertical" ? "vertical" : "horizontal"}
            className="h-full"
          >
            <Panel defaultSize={flipped ? 35 : 65} minSize={15}>
              {flipped ? <CommandTerminal /> : <BrowserViewer />}
            </Panel>
            <ResizeHandle direction={layout} />
            <Panel defaultSize={flipped ? 65 : 35} minSize={20}>
              {flipped ? <BrowserViewer /> : <CommandTerminal />}
            </Panel>
          </Group>
        )}

        {layout === "browser" && <BrowserViewer />}

        {layout === "terminal" && <CommandTerminal />}

        {layout === "floating" && (
          <>
            <BrowserViewer />
            <FloatingTerminal onMinimize={() => switchLayout("browser")} />
          </>
        )}
      </div>
    </div>
  );
}
