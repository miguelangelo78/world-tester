import React, { useState, useEffect } from "react";
import { Download, ChevronDown, ChevronUp, CheckCircle, XCircle, Clock, Play, Loader } from "lucide-react";
import { E2EBrowserViewer } from "./e2e-browser-viewer";
import { useNotification } from "./notification-provider";

interface TestStep {
  stepNumber: number;
  instruction: string;
  status: "passed" | "failed" | "skipped";
  result?: string;
  screenshot?: string;
  durationMs: number;
  errorMessage?: string;
  retryCount: number;
  retryReasons?: string[];
}

interface VisualDiff {
  stepNumber: number;
  similarity: number;
  approved: boolean;
  baselinePath?: string;
  currentPath?: string;
}

interface TestRun {
  id: string;
  test: {
    name: string;
    description?: string;
  };
  status: "passed" | "failed" | "running" | "skipped";
  verdict: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  costUsd: number;
  errorMessage?: string;
  steps: TestStep[];
  visualDiffs?: VisualDiff[];
}

interface E2EResultsViewerProps {
  testId: string;
  onBack?: () => void;
  onExport?: (format: "json" | "pdf" | "html") => Promise<void>;
  onRerun?: (testId: string) => Promise<void>;
  isLoading?: boolean;
}

export const E2EResultsViewer: React.FC<E2EResultsViewerProps> = ({
  testId,
  onBack,
  onRerun,
}) => {
  const [run, setRun] = useState<TestRun | null>(null);
  const [allRuns, setAllRuns] = useState<TestRun[]>([]);
  const [predefinedSteps, setPredefinedSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [rerunning, setRerunning] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const { error: notifyError } = useNotification();

  const isRunning = run?.status === "running";

  const fetchPredefinedSteps = async () => {
    try {
      const response = await fetch(`/api/e2e/tests/${testId}`);
      if (!response.ok) return;
      const data = await response.json();
      setPredefinedSteps(
        Array.isArray(data.steps) ? data.steps : []
      );
    } catch (err) {
      console.warn("Failed to fetch predefined steps:", err);
    }
  };

  const fetchRun = async () => {
    try {
      // Fetch all runs for the test
      const response = await fetch(
        `/api/e2e/tests/${testId}/results?limit=50`
      );
      if (!response.ok) {
        if (response.status === 404) {
          setError(`No results found for test ID: ${testId}`);
        } else {
          setError("Failed to fetch test run");
        }
        setLoading(false);
        return;
      }
      const data = await response.json();
      const runs = Array.isArray(data) ? data : [data];
      
      // Set all runs and the latest one
      setAllRuns(runs);
      if (runs.length > 0) {
        setRun(runs[0]);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch test run");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPredefinedSteps();
    fetchRun();

    const interval = setInterval(() => {
      fetchRun();
    }, 2000);

    return () => clearInterval(interval);
  }, [testId]);

  // Auto-expand failed steps when test completes
  useEffect(() => {
    if (run && !isRunning && run.status === "failed") {
      const failedSteps = run.steps
        .filter((step) => step.status === "failed")
        .map((step) => step.stepNumber);
      
      if (failedSteps.length > 0) {
        setExpandedSteps((prev) => {
          const next = new Set(prev);
          failedSteps.forEach((stepNum) => next.add(stepNum));
          return next;
        });
      }
    }
  }, [run?.status, isRunning, run?.steps]);

  // Countup timer for running tests
  useEffect(() => {
    if (!isRunning || !run) {
      setStartTime(null);
      setElapsedMs(0);
      return;
    }

    // Use the actual test start time from the database
    if (!startTime && run.startedAt) {
      const dbStartTime = new Date(run.startedAt).getTime();
      setStartTime(dbStartTime);
    }

    const timer = setInterval(() => {
      if (startTime) {
        const elapsed = Date.now() - startTime;
        setElapsedMs(elapsed);
      }
    }, 50); // Update every 50ms for smooth millisecond display

    return () => clearInterval(timer);
  }, [isRunning, run, startTime]);

  // Reset timer when test status changes
  useEffect(() => {
    if (run && run.status !== "running") {
      setStartTime(null);
      setElapsedMs(0);
    }
  }, [run?.status]);

  const formatTime = (ms: number): string => {
    const totalSeconds = ms / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    const milliseconds = Math.round(ms % 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s ${milliseconds}ms`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s ${milliseconds}ms`;
    } else {
      return `${secs}s ${milliseconds}ms`;
    }
  };

  const toggleStepExpanded = (stepNumber: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepNumber)) {
        next.delete(stepNumber);
      } else {
        next.add(stepNumber);
      }
      return next;
    });
  };

  const handleRerun = async () => {
    if (!onRerun) return;
    setRerunning(true);
    try {
      await onRerun(testId);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Failed to rerun test");
    } finally {
      setRerunning(false);
    }
  };

  const handleExport = async (format: "json" | "pdf" | "html") => {
    try {
      const response = await fetch(
        `/api/e2e/tests/${testId}/export?format=${format}`
      );
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `test-results.${format === "pdf" ? "pdf" : format === "html" ? "html" : "json"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Export failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-6 text-center">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  const totalSteps = Math.max(predefinedSteps.length, run?.steps.length ?? 0);
  const completedSteps = run?.steps.length ?? 0;
  const progressPercent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="space-y-6">
      {run && (
        <div className="sticky top-0 z-50 bg-card rounded-t-lg shadow p-6 border border-border border-b">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                {run.test?.name || "Test Results"}
              </h1>
              <p className="text-muted-foreground mt-1">
                {run.test?.description || ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium text-blue-500">
                    ⟳ RUNNING
                  </span>
                </span>
              )}
              {run.status === "passed" && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-medium text-green-500">
                    PASSED
                  </span>
                </span>
              )}
              {run.status === "failed" && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/30">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-medium text-red-500">
                    FAILED
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Failure Summary */}
          {run.status === "failed" && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <h3 className="text-sm font-semibold text-red-400 mb-2">Test Failed</h3>
              {run.errorMessage && (
                <p className="text-sm text-red-300 mb-2">{run.errorMessage}</p>
              )}
              
              {/* Show all failed steps */}
              {run.steps.filter((s) => s.status === "failed").length > 0 && (
                <div className="text-sm text-red-300 mb-3">
                  <p className="font-medium">Failed step{run.steps.filter((s) => s.status === "failed").length > 1 ? "s" : ""}:</p>
                  <ul className="list-disc list-inside mt-1">
                    {run.steps
                      .filter((s) => s.status === "failed")
                      .map((step) => (
                        <li key={step.stepNumber}>
                          Step {step.stepNumber}: {step.instruction}
                          {step.errorMessage && (
                            <div className="text-red-400 mt-1 ml-5">
                              → {step.errorMessage}
                            </div>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              
              {/* Show missing steps if test has predefined steps but fewer executed */}
              {predefinedSteps.length > run.steps.length && (
                <div className="text-sm text-yellow-300 bg-yellow-500/10 p-3 rounded border border-yellow-500/30">
                  <p className="font-medium">Test stopped early:</p>
                  <p className="mt-1">Expected {predefinedSteps.length} steps, but only {run.steps.length} executed</p>
                  
                  {/* Show the last step that was attempted and its error */}
                  {run.steps.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-yellow-500/30">
                      <p className="font-medium">Last executed step:</p>
                      <p className="mt-1">Step {run.steps[run.steps.length - 1].stepNumber}: {run.steps[run.steps.length - 1].instruction}</p>
                      {run.steps[run.steps.length - 1].errorMessage && (
                        <p className="text-red-400 mt-1">Error: {run.steps[run.steps.length - 1].errorMessage}</p>
                      )}
                      <p className="text-yellow-400 text-xs mt-2">Status: {run.steps[run.steps.length - 1].status}</p>
                      
                      {/* If last step passed but test still failed, show why */}
                      {run.steps[run.steps.length - 1].status === "passed" && (
                        <div className="mt-2 text-red-400 bg-red-500/20 p-2 rounded border border-red-500/30">
                          <p className="font-medium">Note:</p>
                          <p className="text-xs mt-1">The last step passed, but the test was stopped. This could be due to:</p>
                          <ul className="list-disc list-inside mt-1 text-xs">
                            <li>An error occurred after step execution (screenshot, visual regression check, etc.)</li>
                            <li>A system error or timeout</li>
                            <li>Browser connection lost</li>
                          </ul>
                          <p className="text-xs mt-2">Check the server logs for more details.</p>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Show what steps were not executed */}
                  {predefinedSteps.length > run.steps.length && (
                    <div className="mt-2 pt-2 border-t border-yellow-500/30">
                      <p className="font-medium">Skipped steps:</p>
                      <ul className="list-disc list-inside mt-1 text-xs">
                        {predefinedSteps.slice(run.steps.length).map((step, idx) => (
                          <li key={run.steps.length + idx + 1}>
                            Step {run.steps.length + idx + 1}: {typeof step === "string" ? step : (step as any).instruction}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-6 md:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground uppercase">Duration</p>
              <p className="text-lg font-semibold text-foreground">
                {run.durationMs ? (run.durationMs / 1000).toFixed(2) : "-"}s
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Cost</p>
              <p className="text-lg font-semibold text-foreground">
                ${run.costUsd.toFixed(4)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">{isRunning ? "Elapsed Time" : "Duration"}</p>
              <p className={`text-lg font-semibold ${isRunning ? "text-blue-400 animate-pulse" : "text-foreground"}`}>
                {isRunning ? formatTime(elapsedMs) : formatTime(run.durationMs || 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Progress</p>
              <p className="text-lg font-semibold text-foreground">
                {completedSteps}/{totalSteps}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase">Started</p>
              <p className="text-lg font-semibold text-foreground text-right">
                {new Date(run.startedAt).toLocaleTimeString()}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-foreground">Progress</p>
              <p className="text-sm text-muted-foreground">
                {completedSteps} / {totalSteps} ({Math.round(progressPercent)}%)
              </p>
            </div>
            <div className="w-full bg-muted rounded-full h-6 overflow-hidden flex">
              <div
                className="bg-gradient-to-r from-blue-400 to-blue-600 h-6 transition-all duration-300 ease-out flex items-center justify-center"
                style={{ width: `${progressPercent}%` }}
              >
                {isRunning && (
                  <div className="h-full w-full animate-pulse opacity-75" />
                )}
              </div>
              <div className="flex-1 bg-muted h-6" />
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>{Math.round(progressPercent)}% done</span>
              <span>{Math.round(100 - progressPercent)}% remaining</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => handleExport("json")}
              className="flex items-center gap-2 px-3 py-2 bg-muted hover:bg-muted/80 rounded text-sm text-foreground"
            >
              <Download className="w-4 h-4" />
              JSON
            </button>
            <button
              onClick={() => handleExport("pdf")}
              className="flex items-center gap-2 px-3 py-2 bg-muted hover:bg-muted/80 rounded text-sm text-foreground"
            >
              <Download className="w-4 h-4" />
              PDF
            </button>
            <button
              onClick={() => handleExport("html")}
              className="flex items-center gap-2 px-3 py-2 bg-muted hover:bg-muted/80 rounded text-sm text-foreground"
            >
              <Download className="w-4 h-4" />
              HTML
            </button>
            {onRerun && (
              <button
                onClick={handleRerun}
                disabled={rerunning}
                className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm text-white font-medium"
              >
                {rerunning ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {rerunning ? "Running..." : "Rerun Test"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="px-6">
        {/* Browser Viewer */}
        <E2EBrowserViewer />

        {/* Steps Section */}
        <div className="bg-card rounded-lg shadow p-6 border border-border  mb-6">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-xl font-bold text-foreground">Steps</h2>
          {isRunning && (
            <span className="text-xs bg-blue-500/20 text-blue-500 px-2 py-1 rounded">
              Live
            </span>
          )}
        </div>

        <div className="space-y-3">
          {predefinedSteps.length > 0 ? (
            predefinedSteps.map((instruction, idx) => {
              const stepNum = idx + 1;
              const stepInstruction = typeof instruction === "string" ? instruction : (instruction as any)?.instruction || String(instruction);
              const executedStep = run?.steps?.find((s) => s.stepNumber === stepNum);
              const isExecuted = !!executedStep;
              const isPending = !isExecuted;
              
              // Find the last executed step to determine what's "currently running"
              const lastExecutedStepNum = (run?.steps?.length ?? 0) > 0 
                ? Math.max(...(run?.steps ?? []).map(s => s.stepNumber))
                : 0;
              const isCurrentlyRunning = isRunning && !isExecuted && stepNum === lastExecutedStepNum + 1;
              const isUpcoming = !isExecuted && !isCurrentlyRunning;

              return (
                <div
                  key={idx}
                  className="bg-card rounded-lg shadow border-l-4 transition-all"
                  style={{
                    borderLeftColor: isCurrentlyRunning
                      ? "#3b82f6"
                      : isUpcoming && isRunning
                      ? "#6b7280"
                      : isPending && !isRunning
                      ? "#6b7280"
                      : executedStep?.status === "passed"
                      ? "#22c55e"
                      : executedStep?.status === "failed"
                      ? "#ef4444"
                      : "#6b7280",
                  }}
                >
                  <button
                    onClick={() => toggleStepExpanded(stepNum)}
                    className="w-full px-6 py-4 flex items-center justify-between hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex-shrink-0">
                        {isCurrentlyRunning ? (
                          <Clock className="w-6 h-6 text-blue-500 animate-pulse" />
                        ) : isUpcoming && isRunning ? (
                          <Clock className="w-6 h-6 text-muted-foreground/50" />
                        ) : isPending && !isRunning ? (
                          <Clock className="w-6 h-6 text-muted-foreground/50" />
                        ) : executedStep?.status === "passed" ? (
                          <CheckCircle className="w-6 h-6 text-green-500" />
                        ) : executedStep?.status === "failed" ? (
                          <XCircle className="w-6 h-6 text-red-500" />
                        ) : (
                          <Clock className="w-6 h-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-semibold ${isCurrentlyRunning ? "text-blue-400" : isUpcoming && isRunning ? "text-muted-foreground/60" : isPending && !isRunning ? "text-muted-foreground/60" : "text-foreground"}`}>
                            Step {stepNum}: {stepInstruction}
                          </p>
                          {executedStep && typeof executedStep.retryCount === "number" && executedStep.retryCount > 0 && (
                            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded">
                              {executedStep.retryCount}{" "}
                              {executedStep.retryCount === 1 ? "retry" : "retries"} •{" "}
                              {executedStep.status === "passed"
                                ? `Passed on attempt ${executedStep.retryCount + 1}`
                                : "Failed"}
                            </span>
                          )}
                        </div>
                        {isCurrentlyRunning ? (
                          <p className="text-xs text-blue-400/70 mt-1">
                            Currently executing...
                          </p>
                        ) : isUpcoming && isRunning ? (
                          <p className="text-xs text-muted-foreground/50 mt-1">
                            Waiting to execute...
                          </p>
                        ) : !isRunning && isPending ? (
                          <p className="text-xs text-muted-foreground/60 mt-1">
                            Not executed
                          </p>
                        ) : null}
                      </div>
                      {isExecuted && (
                        <div className="flex-shrink-0 text-sm text-muted-foreground">
                          {executedStep && executedStep.durationMs > 0 ? `${(executedStep.durationMs / 1000).toFixed(2)}s` : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 ml-2">
                      {expandedSteps.has(stepNum) ? (
                        <ChevronUp className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {expandedSteps.has(stepNum) && isExecuted && (
                    <div className="px-6 pb-4 border-t border-border bg-muted/50">
                      {executedStep.result && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-foreground mb-1">
                            Result
                          </h4>
                          <p className="text-sm text-muted-foreground bg-card p-2 rounded border border-border">
                            {(() => {
                              try {
                                const parsed = JSON.parse(executedStep.result);
                                return typeof parsed.text === 'string' ? parsed.text : executedStep.result;
                              } catch {
                                return executedStep.result;
                              }
                            })()}
                          </p>
                        </div>
                      )}

                      {executedStep.errorMessage && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-red-500 mb-1">
                            Error
                          </h4>
                          <p className="text-sm text-red-400 bg-red-500/20 p-2 rounded border border-red-500/30">
                            {executedStep.errorMessage}
                          </p>
                        </div>
                      )}

                      {executedStep.retryCount && executedStep.retryCount > 0 && executedStep.retryReasons && executedStep.retryReasons.length > 0 && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-yellow-500 mb-1">
                            Retry Attempts ({executedStep.retryCount})
                          </h4>
                          <div className="space-y-2">
                            {executedStep.retryReasons.map((reason, idx) => (
                              <div key={idx} className="text-sm bg-yellow-500/10 p-2 rounded border border-yellow-500/30">
                                <p className="text-yellow-600 font-medium">Attempt {idx + 1}:</p>
                                <p className="text-yellow-700 mt-1">{reason}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {executedStep.screenshot && (
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-foreground mb-2">
                            Screenshots
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Before Screenshot */}
                            <div>
                              <p className="text-xs text-muted-foreground mb-2 font-medium">Before</p>
                              <div className="border border-border rounded bg-muted overflow-hidden">
                                <img
                                  src={run ? `/api/e2e/steps/${run.id}/${executedStep.stepNumber}/screenshot?type=before` : "#"}
                                  alt={`Step ${stepNum} - Before`}
                                  className="max-w-full h-auto"
                                  onError={(e) => {
                                    console.warn(`Failed to load before screenshot for step ${stepNum}:`, (e.target as HTMLImageElement).src);
                                    (e.target as HTMLImageElement).src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23374151' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%239ca3af' font-family='sans-serif'%3EBefore screenshot not available%3C/text%3E%3C/svg%3E`;
                                  }}
                                />
                              </div>
                            </div>

                            {/* After Screenshot */}
                            <div>
                              <p className="text-xs text-muted-foreground mb-2 font-medium">After</p>
                              <div className="border border-border rounded bg-muted overflow-hidden">
                                <img
                                  src={run ? `/api/e2e/steps/${run.id}/${executedStep.stepNumber}/screenshot?type=after` : "#"}
                                  alt={`Step ${stepNum} - After`}
                                  className="max-w-full h-auto"
                                  onError={(e) => {
                                    console.warn(`Failed to load after screenshot for step ${stepNum}:`, (e.target as HTMLImageElement).src);
                                    (e.target as HTMLImageElement).src = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23374151' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%239ca3af' font-family='sans-serif'%3EAfter screenshot not available%3C/text%3E%3C/svg%3E`;
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="bg-card rounded-lg shadow p-8 border border-border text-center">
              <p className="text-muted-foreground">
                No test steps defined
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Run History */}
      {allRuns.length > 1 && (
        <div className="bg-card rounded-lg shadow border border-border  mb-6">
          <div className="p-6">
            <h2 className="text-lg font-bold text-foreground mb-4">Run History</h2>
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-6">Run #</th>
                    <th className="text-left py-2 px-6">Date & Time</th>
                    <th className="text-left py-2 px-6">Status</th>
                    <th className="text-left py-2 px-6">Duration</th>
                    <th className="text-left py-2 px-6">Cost</th>
                    <th className="text-left py-2 px-6">Steps</th>
                  </tr>
                </thead>
                <tbody>
                  {allRuns.map((testRun, idx) => (
                    <tr 
                      key={testRun.id} 
                      className={`border-b border-border cursor-pointer transition-colors ${
                        run?.id === testRun.id
                          ? "bg-blue-500/10 hover:bg-blue-500/20"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => {
                        setRun(testRun);
                        setExpandedSteps(new Set());
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <td className="py-3 px-6 text-muted-foreground font-medium">#{allRuns.length - idx}</td>
                      <td className="py-3 px-6 text-foreground">
                        {new Date(testRun.startedAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-6">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                            testRun.status === "passed"
                              ? "bg-green-500/20 text-green-500"
                              : testRun.status === "failed"
                              ? "bg-red-500/20 text-red-500"
                              : testRun.status === "running"
                              ? "bg-blue-500/20 text-blue-500"
                              : "bg-gray-500/20 text-gray-500"
                          }`}
                        >
                          {testRun.status.charAt(0).toUpperCase() + testRun.status.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-6 text-muted-foreground">
                        {testRun.durationMs ? `${(testRun.durationMs / 1000).toFixed(2)}s` : "-"}
                      </td>
                      <td className="py-3 px-6 text-foreground font-medium">
                        ${testRun.costUsd.toFixed(4)}
                      </td>
                      <td className="py-3 px-6 text-muted-foreground">
                        {testRun.steps?.length || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default E2EResultsViewer;
