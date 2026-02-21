import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { MemoryManager } from "../memory/manager.js";
import { SiteKnowledge, Learning } from "../memory/types.js";
import { CostTracker } from "../cost/tracker.js";
import { ModeResult, runAct } from "./modes.js";
import { UsageData } from "../cost/tracker.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { planTest, PlanContext } from "./test-planner.js";
import { verifyStep } from "./verify.js";
import { captureScreenshot } from "../browser/stagehand.js";
import type { BrowserPool } from "../browser/pool.js";
import { extractTestStepLearning, extractTestRunLearnings } from "./learning.js";
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
import type { OutputSink } from "../output-sink.js";

export interface TestRunResult extends ModeResult {
  report: TestReport;
  reportId: string;
}

function urlFromStagehand(sh: Stagehand): string {
  try {
    return ((sh.context as any).activePage?.() ?? sh.context.pages()[0])?.url() ?? "about:blank";
  } catch {
    return "about:blank";
  }
}

function domainFromStagehand(sh: Stagehand): string {
  try {
    return new URL(urlFromStagehand(sh)).hostname;
  } catch {
    return "unknown";
  }
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
  pool?: BrowserPool,
  sink?: OutputSink,
): Promise<TestRunResult> {
  const startTime = Date.now();
  let totalUsage: UsageData = { input_tokens: 0, output_tokens: 0 };
  const domain = domainFromStagehand(stagehand);
  const currentUrl = urlFromStagehand(stagehand);
  const testTaskId = "test-" + Date.now().toString(36);

  // ── Phase 1: Plan ─────────────────────────────────────────────────
  sink?.info("Planning test steps...");
  const planContext: PlanContext = {
    currentUrl,
    activeBrowsers: pool ? pool.list().map((b) => b.name) : undefined,
  };
  const plan = await planTest(
    instruction,
    config,
    siteKnowledge,
    learnings,
    currentUrl,
    planContext,
  );

  const setupCount = plan.steps.filter((s) => s.setup).length;
  const assertCount = plan.steps.length - setupCount;
  sink?.info(`Test: ${plan.title} (${plan.steps.length} steps — ${setupCount} setup, ${assertCount} assertion)`);
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const kind = s.setup ? "setup" : s.critical ? "assert" : "optional";
    const browserTag = s.browser ? ` [${s.browser}]` : "";
    sink?.log(`  ${i + 1}. [${kind}]${browserTag} ${s.action}`);
    sink?.log(`     Expected: ${s.expected}`);
  }
  sink?.log("");

  // ── Phase 2: Execute + Verify each step ───────────────────────────
  const results: StepResult[] = [];
  let aborted = false;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    if (aborted) {
      sink?.testStep(i, plan.steps.length, step.action, "skip");
      results.push({
        step,
        verdict: "skip",
        actual: "Skipped — earlier critical step failed",
        evidence: "",
        durationMs: 0,
      });
      continue;
    }

    sink?.testStep(i, plan.steps.length, step.action, "running");
    const stepStart = Date.now();

    // Resolve browser: if the step specifies one, use it (auto-spawn if needed)
    let stepStagehand = stagehand;
    if (step.browser && pool) {
      if (!pool.has(step.browser)) {
        sink?.info(`Spawning browser "${step.browser}" for this test...`);
        try {
          await pool.spawn(step.browser, { profile: "isolated" });
        } catch (err) {
          sink?.warn(`Failed to spawn browser "${step.browser}": ${err}`);
        }
      }
      if (pool.has(step.browser)) {
        stepStagehand = pool.get(step.browser).stagehand;
      }
    }

    // Screenshot before (from the correct browser)
    let screenshotBefore: string | undefined;
    try {
      screenshotBefore = await captureScreenshot(`step${i + 1}_before`, stepStagehand);
    } catch {
      // Non-fatal
    }

    // Execute
    const execResult = await executeStep(
      stepStagehand,
      step,
      i,
      plan,
      config,
      siteKnowledge,
      learnings,
    );
    totalUsage = mergeUsage(totalUsage, execResult.usage);

    // Brief wait for SPA content to settle after actions (filters, navigation, etc.)
    try {
      const page = (stepStagehand.context as any).activePage?.() ?? stepStagehand.context.pages()[0];
      if (page) await page.waitForTimeout(1500);
    } catch { /* non-fatal */ }

    // Screenshot after (from the correct browser)
    let screenshotAfter: string | undefined;
    try {
      screenshotAfter = await captureScreenshot(`step${i + 1}_after`, stepStagehand);
    } catch {
      // Non-fatal
    }

    // Verify — pass the CUA's own description as primary evidence
    const verification = await verifyStep(
      stepStagehand,
      config,
      step.action,
      step.expected,
      execResult.message,
    );

    const verdict = verification.passed ? "pass" : "fail";
    const stepDuration = Date.now() - stepStart;

    sink?.testStep(i, plan.steps.length, step.action, verdict);

    results.push({
      step,
      verdict,
      actual: verification.actual,
      evidence: verification.evidence,
      screenshotBefore,
      screenshotAfter,
      durationMs: stepDuration,
    });

    // Learn from this step — use the step's actual domain, not the initial one
    const stepDomain = domainFromStagehand(stepStagehand);
    extractTestStepLearning(
      memory, stepDomain || domain, testTaskId, step, verdict, verification.actual, stepDuration,
    ).catch(() => {});

    if (verdict === "fail" && step.critical) {
      sink?.warn(
        `Critical step ${i + 1} failed — skipping remaining steps`,
      );
      aborted = true;
    }
  }

  // ── Phase 3: Report ───────────────────────────────────────────────
  const passed = results.filter((r) => r.verdict === "pass").length;
  const failed = results.filter((r) => r.verdict === "fail").length;

  // Assertion steps are non-setup steps — these determine the verdict.
  // Setup steps (navigation, waiting, locating) are prerequisites; their
  // failure aborts the test but a passing setup step doesn't mean the
  // test passed.
  const assertionResults = results.filter((r) => !r.step.setup);
  const assertionFailed = assertionResults.filter((r) => r.verdict === "fail").length;
  const assertionPassed = assertionResults.filter((r) => r.verdict === "pass").length;
  const setupFailed = results.some(
    (r) => r.verdict === "fail" && r.step.setup,
  );

  let verdict: TestVerdict;
  if (setupFailed) {
    verdict = "fail";
  } else if (assertionResults.length === 0) {
    verdict = failed === 0 ? "pass" : "fail";
  } else if (assertionFailed === 0) {
    verdict = "pass";
  } else if (assertionPassed === 0) {
    verdict = "fail";
  } else {
    verdict = "partial";
  }

  const totalDuration = Date.now() - startTime;
  const costSnapshot = costTracker.getSessionTotal();

  const report: TestReport = {
    title: plan.title,
    timestamp: new Date().toISOString(),
    domain,
    steps: results,
    verdict,
    summary: buildSummaryMessage({
      title: plan.title,
      timestamp: new Date().toISOString(),
      domain,
      steps: results,
      verdict,
      summary: "",
      durationMs: totalDuration,
      costUsd: costSnapshot.costUsd,
    }),
    durationMs: totalDuration,
    costUsd: costSnapshot.costUsd,
  };

  const reportId = await saveReport(report);
  printReportSummary(report, sink);
  sink?.info(`Report saved: ${reportId}`);

  // Post-test learning extraction (fire-and-forget)
  extractTestRunLearnings(
    stagehand, memory, domain, plan.title,
    results.map((r) => ({
      step: r.step,
      verdict: r.verdict,
      actual: r.actual,
      durationMs: r.durationMs,
    })),
    verdict, testTaskId,
  ).catch(() => {});

  return {
    message: report.summary,
    usage: totalUsage,
    success: verdict === "pass",
    report,
    reportId,
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
