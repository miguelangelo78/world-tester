import prisma from "../db.js";
import { TestReport, StepResult } from "./test-types.js";
import type { OutputSink } from "../output-sink.js";

export async function saveReport(report: TestReport): Promise<string> {
  const row = await prisma.testReport.create({
    data: {
      title: report.title,
      timestamp: new Date(report.timestamp),
      domain: report.domain,
      steps: report.steps as unknown as object,
      verdict: report.verdict,
      summary: report.summary,
      durationMs: report.durationMs,
      costUsd: report.costUsd,
    },
  });
  return row.id;
}

export function printReportSummary(report: TestReport, sink?: OutputSink): void {
  const passed = report.steps.filter((s) => s.verdict === "pass").length;
  const failed = report.steps.filter((s) => s.verdict === "fail").length;
  const skipped = report.steps.filter((s) => s.verdict === "skip").length;

  const log = (msg: string) => sink ? sink.log(msg) : console.log(msg);

  log(`\n  Test: ${report.title}`);
  log(`  Domain: ${report.domain}`);
  log(`  Time: ${report.timestamp}\n`);

  for (let i = 0; i < report.steps.length; i++) {
    const s = report.steps[i];
    printStepLine(i, report.steps.length, s, log);
  }

  const verdictLine = `\n  VERDICT: ${report.verdict.toUpperCase()}`;
  const statsLine = `  ${passed} passed  ${failed} failed  ${skipped} skipped`;
  const durationLine = `\n  Duration: ${(report.durationMs / 1000).toFixed(1)}s | Cost: $${report.costUsd.toFixed(4)}`;

  log(verdictLine);
  log(statsLine);
  log(durationLine);
}

function printStepLine(
  index: number,
  total: number,
  step: StepResult,
  log: (msg: string) => void,
): void {
  const icon =
    step.verdict === "pass"
      ? "PASS"
      : step.verdict === "fail"
        ? "FAIL"
        : "SKIP";

  const kindTag = step.step.setup ? " [setup]" : "";
  const action =
    step.step.action.length > 70
      ? step.step.action.slice(0, 67) + "..."
      : step.step.action;

  log(`  [${index + 1}/${total}] ${icon}${kindTag} ${action}`);

  if (step.verdict === "fail") {
    log(`         Expected: ${step.step.expected}`);
    log(`         Actual:   ${step.actual}`);
    if (step.evidence) {
      log(`         Evidence: ${step.evidence}`);
    }
  }
}

export function buildSummaryMessage(report: TestReport): string {
  const passed = report.steps.filter((s) => s.verdict === "pass").length;
  const failed = report.steps.filter((s) => s.verdict === "fail").length;
  const skipped = report.steps.filter((s) => s.verdict === "skip").length;

  const lines: string[] = [
    `Test: ${report.title}`,
    `Verdict: ${report.verdict.toUpperCase()}`,
    `Steps: ${passed} passed, ${failed} failed, ${skipped} skipped`,
    `Duration: ${(report.durationMs / 1000).toFixed(1)}s`,
    "",
  ];

  for (let i = 0; i < report.steps.length; i++) {
    const s = report.steps[i];
    const tag = s.verdict.toUpperCase();
    lines.push(`  ${i + 1}. [${tag}] ${s.step.action}`);
    if (s.verdict === "fail") {
      lines.push(`     Expected: ${s.step.expected}`);
      lines.push(`     Actual: ${s.actual}`);
    }
  }

  return lines.join("\n");
}
