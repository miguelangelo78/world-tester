import chalk from "chalk";
import prisma from "../db.js";
import { TestReport, StepResult } from "./test-types.js";
import * as display from "../cli/display.js";

/**
 * Persists a test report to the database and prints a
 * human-readable summary to the console. Returns the generated report ID.
 */
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

export function printReportSummary(report: TestReport): void {
  const passed = report.steps.filter((s) => s.verdict === "pass").length;
  const failed = report.steps.filter((s) => s.verdict === "fail").length;
  const skipped = report.steps.filter((s) => s.verdict === "skip").length;

  console.log(chalk.bold(`\n  Test: ${report.title}`));
  console.log(chalk.dim(`  Domain: ${report.domain}`));
  console.log(chalk.dim(`  Time: ${report.timestamp}\n`));

  for (let i = 0; i < report.steps.length; i++) {
    const s = report.steps[i];
    printStepLine(i, report.steps.length, s);
  }

  display.testVerdict(passed, failed, skipped, report.verdict);
  console.log(
    chalk.dim(`\n  Duration: ${(report.durationMs / 1000).toFixed(1)}s | Cost: $${report.costUsd.toFixed(4)}`),
  );
}

function printStepLine(
  index: number,
  total: number,
  step: StepResult,
): void {
  const icon =
    step.verdict === "pass"
      ? chalk.green("PASS")
      : step.verdict === "fail"
        ? chalk.red("FAIL")
        : chalk.dim("SKIP");

  const action =
    step.step.action.length > 70
      ? step.step.action.slice(0, 67) + "..."
      : step.step.action;

  console.log(`  [${index + 1}/${total}] ${icon} ${action}`);

  if (step.verdict === "fail") {
    console.log(chalk.red(`         Expected: ${step.step.expected}`));
    console.log(chalk.red(`         Actual:   ${step.actual}`));
    if (step.evidence) {
      console.log(chalk.dim(`         Evidence: ${step.evidence}`));
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
