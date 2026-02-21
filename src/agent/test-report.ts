import fs from "fs";
import path from "path";
import chalk from "chalk";
import { TestReport, StepResult } from "./test-types.js";
import * as display from "../cli/display.js";

const REPORTS_DIR = path.resolve("data", "test-reports");

/**
 * Persists a JSON test report to data/test-reports/ and prints a
 * human-readable summary to the console.
 */
export function saveReport(report: TestReport): string {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = report.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const fileName = `${ts}_${safeName}.json`;
  const filePath = path.join(REPORTS_DIR, fileName);

  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
  return filePath;
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
