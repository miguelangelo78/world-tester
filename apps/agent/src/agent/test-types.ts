export interface TestStep {
  action: string;
  expected: string;
  critical: boolean;
  /** Setup steps block on failure but don't affect the pass/fail verdict. */
  setup?: boolean;
  browser?: string;
}

export interface TestPlan {
  title: string;
  steps: TestStep[];
}

export type StepVerdict = "pass" | "fail" | "skip";

export interface StepResult {
  step: TestStep;
  verdict: StepVerdict;
  actual: string;
  evidence: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
  durationMs: number;
}

export type TestVerdict = "pass" | "fail" | "partial";

export interface TestReport {
  title: string;
  timestamp: string;
  domain: string;
  steps: StepResult[];
  verdict: TestVerdict;
  summary: string;
  durationMs: number;
  costUsd: number;
}
