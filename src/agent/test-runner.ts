import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { MemoryManager } from "../memory/manager.js";
import { SiteKnowledge, Learning } from "../memory/types.js";
import { CostTracker } from "../cost/tracker.js";
import { ModeResult, runAct } from "./modes.js";
import { UsageData } from "../cost/tracker.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { planTest } from "./test-planner.js";
import { verifyStep } from "./verify.js";
import { captureScreenshot, getCurrentUrl, getDomain } from "../browser/stagehand.js";
import {
  saveReport,
  printReportSummary,
  buildSummaryMessage,
} from "./test-report.js";
import {
  TestPlan,
  TestReport,
  StepResult,
  TestVerdict,
  TestStep,
} from "./test-types.js";
import * as display from "../cli/display.js";

export interface TestRunResult extends ModeResult {
  report: TestReport;
  reportPath: string;
}

/**
 * End-to-end QA test runner: plans -> executes -> verifies -> reports.
 */
export async function runTest(
  stagehand: Stagehand,
  instruction: string,
  config: AppConfig,
  costTracker: CostTracker,
  memory: MemoryManager,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
): Promise<TestRunResult> {
  const startTime = Date.now();
  let totalUsage: UsageData = { input_tokens: 0, output_tokens: 0 };

  // ── Phase 1: Plan ─────────────────────────────────────────────────
  display.info("Planning test steps...");
  const plan = await planTest(
    instruction,
    config,
    siteKnowledge,
    learnings,
    getCurrentUrl(),
  );

  display.info(`Test: ${plan.title} (${plan.steps.length} steps)`);
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const tag = s.critical ? "critical" : "optional";
    console.log(`  ${i + 1}. [${tag}] ${s.action}`);
    console.log(`     Expected: ${s.expected}`);
  }
  console.log();

  // ── Phase 2: Execute + Verify each step ───────────────────────────
  const results: StepResult[] = [];
  let aborted = false;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (aborted) {
      display.testStep(i, plan.steps.length, step.action, "skip");
      results.push({
        step,
        verdict: "skip",
        actual: "Skipped — earlier critical step failed",
        evidence: "",
        durationMs: 0,
      });
      continue;
    }

    display.testStep(i, plan.steps.length, step.action, "running");
    const stepStart = Date.now();

    // Screenshot before
    let screenshotBefore: string | undefined;
    try {
      screenshotBefore = await captureScreenshot(`step${i + 1}_before`);
    } catch {
      // Non-fatal
    }

    // Execute
    const execResult = await executeStep(
      stagehand,
      step,
      i,
      plan,
      config,
      siteKnowledge,
      learnings,
    );
    totalUsage = mergeUsage(totalUsage, execResult.usage);

    // Screenshot after
    let screenshotAfter: string | undefined;
    try {
      screenshotAfter = await captureScreenshot(`step${i + 1}_after`);
    } catch {
      // Non-fatal
    }

    // Verify — pass the CUA's own description as primary evidence
    const verification = await verifyStep(
      stagehand,
      config,
      step.action,
      step.expected,
      execResult.message,
    );

    const verdict = verification.passed ? "pass" : "fail";
    const stepDuration = Date.now() - stepStart;

    display.testStep(i, plan.steps.length, step.action, verdict);

    results.push({
      step,
      verdict,
      actual: verification.actual,
      evidence: verification.evidence,
      screenshotBefore,
      screenshotAfter,
      durationMs: stepDuration,
    });

    if (verdict === "fail" && step.critical) {
      display.warn(
        `Critical step ${i + 1} failed — skipping remaining steps`,
      );
      aborted = true;
    }
  }

  // ── Phase 3: Report ───────────────────────────────────────────────
  const passed = results.filter((r) => r.verdict === "pass").length;
  const failed = results.filter((r) => r.verdict === "fail").length;

  let verdict: TestVerdict;
  if (failed === 0) verdict = "pass";
  else if (passed === 0) verdict = "fail";
  else verdict = "partial";

  const totalDuration = Date.now() - startTime;
  const costSnapshot = costTracker.getSessionTotal();

  const report: TestReport = {
    title: plan.title,
    timestamp: new Date().toISOString(),
    domain: getDomain(),
    steps: results,
    verdict,
    summary: buildSummaryMessage({
      title: plan.title,
      timestamp: new Date().toISOString(),
      domain: getDomain(),
      steps: results,
      verdict,
      summary: "",
      durationMs: totalDuration,
      costUsd: costSnapshot.costUsd,
    }),
    durationMs: totalDuration,
    costUsd: costSnapshot.costUsd,
  };

  const reportPath = saveReport(report);
  printReportSummary(report);
  display.info(`Report saved: ${reportPath}`);

  return {
    message: report.summary,
    usage: totalUsage,
    success: verdict === "pass",
    report,
    reportPath,
  };
}

/**
 * Executes a single test step. Simple actions use `runAct`; everything else
 * uses a dedicated CUA agent with a lean, step-focused system prompt that
 * prevents the agent from wandering off to unrelated tasks.
 */
async function executeStep(
  stagehand: Stagehand,
  step: TestStep,
  stepIndex: number,
  plan: TestPlan,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
): Promise<ModeResult> {
  const isSimple =
    /^(click|type|press|scroll|check|uncheck|select|toggle)\b/i.test(step.action) &&
    step.action.length < 120;

  if (isSimple) {
    try {
      return await runAct(stagehand, step.action);
    } catch {
      // Fall through to CUA
    }
  }

  // Build a lean system prompt — site knowledge for navigation help, but
  // no base prompt identity (which can confuse the CUA into exploring)
  const siteContext = buildSystemPrompt(siteKnowledge, learnings, {
    skipBasePrompt: true,
  });

  const testSystemPrompt = [
    `You are executing step ${stepIndex + 1} of ${plan.steps.length} in a QA test: "${plan.title}".`,
    `Your ONLY job is to perform the action described below. Do NOT do anything else.`,
    `Do NOT explore, test, or navigate to pages unrelated to this step.`,
    `Do NOT invent or substitute a different goal.`,
    ``,
    `ACTION: ${step.action}`,
    `EXPECTED OUTCOME: ${step.expected}`,
    ``,
    `Once the action is complete, stop immediately and report what happened.`,
    siteContext ? `\nSite reference (use ONLY for navigation help):\n${siteContext}` : "",
  ].join("\n");

  const instruction = `${step.action}\n\nAfter completing this action, stop and describe what you see. The expected outcome is: ${step.expected}`;

  const agent = stagehand.agent({
    mode: "cua",
    model: {
      modelName: config.cuaModel,
      apiKey: config.apiKey,
    },
    systemPrompt: testSystemPrompt,
  });

  const result = await agent.execute({
    instruction,
    maxSteps: 15,
    highlightCursor: true,
  });

  return {
    message: result.message ?? "Step completed.",
    usage: result.usage as UsageData | undefined,
    actions: result.actions as unknown[] | undefined,
    success: result.success === true,
  };
}

function mergeUsage(
  a: UsageData | undefined,
  b: UsageData | undefined,
): UsageData {
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
  };
}
