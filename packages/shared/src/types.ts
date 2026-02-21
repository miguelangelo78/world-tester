// ── WebSocket Protocol ─────────────────────────────────────────────

export type WSMessageType =
  | "command"
  | "command_result"
  | "stream_chunk"
  | "stream_end"
  | "step_update"
  | "cost_update"
  | "status_update"
  | "screenshot"
  | "error"
  | "browser_state"
  | "log";

export interface WSMessage {
  type: WSMessageType;
  id?: string;
  payload: unknown;
}

// ── Client -> Agent Messages ───────────────────────────────────────

export interface CommandMessage extends WSMessage {
  type: "command";
  payload: {
    raw: string;
  };
}

// ── Agent -> Client Messages ───────────────────────────────────────

export interface CommandResultPayload {
  message: string;
  success: boolean;
  mode: string;
  durationMs: number;
}

export interface StreamChunkPayload {
  text: string;
}

export interface StepUpdatePayload {
  index: number;
  total: number;
  action: string;
  status: "running" | "pass" | "fail" | "skip";
  expected?: string;
  actual?: string;
  evidence?: string;
}

export interface CostUpdatePayload {
  action: { inputTokens: number; outputTokens: number; costUsd: number };
  session: { inputTokens: number; outputTokens: number; costUsd: number };
  billing: { costUsd: number; inputTokens: number; outputTokens: number; sessionCount: number; cycleStart: string };
}

export interface BrowserInfo {
  name: string;
  isActive: boolean;
  tabs: { index: number; url: string; title?: string }[];
  activeTabIndex: number;
}

export interface BrowserStatePayload {
  browsers: BrowserInfo[];
  activeUrl: string;
}

export interface ScreenshotPayload {
  label: string;
  path: string;
  timestamp: string;
}

export interface LogPayload {
  level: "info" | "success" | "warn" | "error" | "agent";
  message: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}

// ── Shared Domain Types ────────────────────────────────────────────
// Duplicated from agent types to avoid cross-package source imports.
// Keep in sync with apps/agent/src/memory/types.ts and test-types.ts.

export type StepVerdict = "pass" | "fail" | "skip";
export type TestVerdict = "pass" | "fail" | "partial";

export interface TestStepResult {
  action: string;
  expected: string;
  setup?: boolean;
  browser?: string;
  verdict: StepVerdict;
  actual: string;
  evidence: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
  durationMs: number;
}

export interface TestReport {
  title: string;
  timestamp: string;
  domain: string;
  steps: TestStepResult[];
  verdict: TestVerdict;
  summary: string;
  durationMs: number;
  costUsd: number;
}

export interface TaskRecord {
  id: string;
  timestamp: string;
  command: string;
  instruction: string;
  mode: string;
  domain?: string;
  outcome: "pass" | "fail" | "blocked" | "partial";
  result?: string;
  durationMs: number;
  costUsd: number;
}

export type LearningCategory = "navigation" | "recipe" | "gotcha" | "general";

export interface Learning {
  id: string;
  domain: string;
  category: LearningCategory;
  pattern: string;
  confidence: number;
}

export interface SiteKnowledgeSummary {
  domain: string;
  siteDescription?: string;
  pageCount: number;
  siteMap: string[];
  flowCount: number;
  tipCount: number;
  issueCount: number;
}
