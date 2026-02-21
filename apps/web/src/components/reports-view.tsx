"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  X,
} from "lucide-react";
import { useAgent } from "./agent-provider";
import { PageHeader } from "./page-header";
import type { WSMessage, TestReport, TestStepResult } from "@world-tester/shared";

const verdictConfig = {
  pass: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10", label: "PASS" },
  fail: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", label: "FAIL" },
  partial: { icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10", label: "PARTIAL" },
};

const stepVerdictConfig = {
  pass: { icon: CheckCircle2, color: "text-success", label: "PASS" },
  fail: { icon: XCircle, color: "text-destructive", label: "FAIL" },
  skip: { icon: MinusCircle, color: "text-muted-foreground", label: "SKIP" },
};

export function ReportsView() {
  const { status, sendCommand, onMessage } = useAgent();
  const [reports, setReports] = useState<TestReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);

  const fetchReports = useCallback(() => {
    if (status !== "connected") return;
    setLoading(true);

    const id = sendCommand("__get_reports");
    const unsub = onMessage((msg: WSMessage) => {
      if (msg.id === id && msg.type === "command_result") {
        try {
          const data = JSON.parse((msg.payload as { message: string }).message);
          setReports(Array.isArray(data) ? data : []);
        } catch {
          setReports([]);
        }
        setLoading(false);
        unsub();
      }
    });
  }, [status, sendCommand, onMessage]);

  const autoLoaded = useRef(false);
  useEffect(() => {
    if (status === "connected" && !autoLoaded.current) {
      autoLoaded.current = true;
      fetchReports();
    }
  }, [status, fetchReports]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        left={
          <>
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">Test Reports</h1>
          </>
        }
        right={
          <button
            onClick={fetchReports}
            disabled={status !== "connected" || loading}
            className="rounded-md bg-accent px-3 py-1 text-xs text-accent-foreground hover:bg-accent/80 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Reports"}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {status !== "connected" ? (
          <Empty text="Connect to the agent to view test reports." />
        ) : reports.length === 0 ? (
          <Empty text="No test reports yet. Run a test command to generate reports." />
        ) : (
          <div className="divide-y divide-border">
            {reports.map((report, idx) => {
              const vc = verdictConfig[report.verdict];
              const VerdictIcon = vc.icon;
              const expanded = expandedReport === idx;
              return (
                <div key={idx}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/30"
                    onClick={() => setExpandedReport(expanded ? null : idx)}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    )}
                    <VerdictIcon className={`h-4 w-4 flex-shrink-0 ${vc.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${vc.bg} ${vc.color}`}>
                          {vc.label}
                        </span>
                        <span className="text-sm font-medium truncate">{report.title}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                        <span>{report.domain}</span>
                        <span className="hidden sm:inline">{new Date(report.timestamp).toLocaleString()}</span>
                        <span className="sm:hidden">{new Date(report.timestamp).toLocaleDateString()}</span>
                        <span>{(report.durationMs / 1000).toFixed(1)}s</span>
                        <span>${report.costUsd.toFixed(4)}</span>
                      </div>
                    </div>
                  </button>
                  {expanded && <ReportDetail report={report} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ReportDetail({ report }: { report: TestReport }) {
  return (
    <div className="border-t border-border bg-card/50 px-3 sm:px-6 py-4 space-y-4">
      <p className="text-xs text-muted-foreground">{report.summary}</p>

      <div className="space-y-2">
        {report.steps.map((step, idx) => (
          <StepRow key={idx} step={step} index={idx + 1} total={report.steps.length} />
        ))}
      </div>

      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span>
          {report.steps.filter((s) => s.verdict === "pass").length} passed
        </span>
        <span>
          {report.steps.filter((s) => s.verdict === "fail").length} failed
        </span>
        <span>
          {report.steps.filter((s) => s.verdict === "skip").length} skipped
        </span>
      </div>
    </div>
  );
}

function getAgentHttpUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3100";
  return process.env.NEXT_PUBLIC_AGENT_HTTP_URL ?? `http://${window.location.hostname}:3100`;
}

function screenshotUrl(urlPath: string | undefined): string | null {
  if (!urlPath) return null;
  return `${getAgentHttpUrl()}${urlPath}`;
}

function ScreenshotLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 rounded-full bg-card p-2 text-foreground hover:bg-accent"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Screenshot"
        className="max-h-[90vh] max-w-[90vw] rounded-lg border border-border shadow-2xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ScreenshotThumbnail({ src, label }: { src: string; label: string }) {
  const [lightbox, setLightbox] = useState(false);

  return (
    <>
      <button
        onClick={() => setLightbox(true)}
        className="group relative rounded border border-border overflow-hidden hover:border-primary/50 transition-colors"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className="h-24 w-40 object-cover object-top"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <ImageIcon className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[8px] text-white truncate">
          {label}
        </span>
      </button>
      {lightbox && <ScreenshotLightbox src={src} onClose={() => setLightbox(false)} />}
    </>
  );
}

function StepRow({ step, index, total }: { step: TestStepResult; index: number; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const vc = stepVerdictConfig[step.verdict];
  const Icon = vc.icon;

  const beforeUrl = screenshotUrl(step.screenshotBefore);
  const afterUrl = screenshotUrl(step.screenshotAfter);
  const hasScreenshots = !!beforeUrl || !!afterUrl;

  return (
    <div className="rounded border border-border">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent/20"
        onClick={() => setExpanded(!expanded)}
      >
        <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${vc.color}`} />
        <span className="text-muted-foreground">[{index}/{total}]</span>
        <span className={step.setup ? "text-muted-foreground" : ""}>
          {step.setup && <span className="opacity-60">[setup] </span>}
          {step.action}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {hasScreenshots && <ImageIcon className="h-3 w-3 text-muted-foreground" />}
          <span className={`text-[10px] font-bold ${vc.color}`}>{vc.label}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 text-[10px] space-y-2">
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Expected: </span>
              <span>{step.expected}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Actual: </span>
              <span>{step.actual || "—"}</span>
            </div>
            {step.evidence && (
              <div>
                <span className="text-muted-foreground">Evidence: </span>
                <span className="italic">{step.evidence}</span>
              </div>
            )}
            <div className="text-muted-foreground">
              Duration: {(step.durationMs / 1000).toFixed(1)}s
              {step.browser && <span> | Browser: {step.browser}</span>}
            </div>
          </div>

          {hasScreenshots && (
            <div className="flex flex-wrap gap-2 pt-1">
              {beforeUrl && <ScreenshotThumbnail src={beforeUrl} label="Before" />}
              {afterUrl && <ScreenshotThumbnail src={afterUrl} label="After" />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      {text}
    </div>
  );
}
