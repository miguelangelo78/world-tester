import { PrismaClient } from "@prisma/client";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export interface ExportOptions {
  includeScreenshots?: boolean;
  includeSteps?: boolean;
  format?: "json" | "pdf" | "html";
}

/**
 * Export test results in various formats
 */
export class TestResultExporter {
  constructor(private prisma: PrismaClient) {}

  /**
   * Export a test run in specified format
   */
  async exportRun(
    runId: string,
    format: "json" | "pdf" | "html" = "json",
    options: ExportOptions = {},
  ): Promise<Buffer | string> {
    // Fetch complete run data
    const run = await this.prisma.e2ETestRun.findUnique({
      where: { id: runId },
      include: {
        test: true,
        steps: true,
        visualDiffs: true,
      },
    });

    if (!run) throw new Error("Run not found");

    switch (format) {
      case "json":
        return this.exportJSON(run);
      case "pdf":
        return await this.exportPDF(run, options);
      case "html":
        return this.exportHTML(run, options);
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
  }

  /**
   * Export test results history
   */
  async exportTestHistory(
    testId: string,
    format: "json" | "pdf" | "html" = "json",
    limit: number = 50,
  ): Promise<Buffer | string> {
    const test = await this.prisma.e2ETest.findUnique({
      where: { id: testId },
      include: {
        runs: {
          include: { steps: true },
          orderBy: { startedAt: "desc" },
          take: limit,
        },
      },
    });

    if (!test) throw new Error("Test not found");

    switch (format) {
      case "json":
        return JSON.stringify(
          {
            test: {
              id: test.id,
              name: test.name,
              description: test.description,
            },
            runs: test.runs,
            totalRuns: test.runs.length,
            passRate: this.calculatePassRate(test.runs),
          },
          null,
          2,
        );
      case "pdf":
        return await this.exportHistoryPDF(test);
      case "html":
        return this.exportHistoryHTML(test);
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
  }

  /**
   * Export as JSON
   */
  private exportJSON(run: any): string {
    return JSON.stringify(
      {
        test: {
          id: run.test.id,
          name: run.test.name,
          description: run.test.description,
        },
        run: {
          id: run.id,
          status: run.status,
          verdict: run.verdict,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: run.durationMs,
          costUsd: run.costUsd,
        },
        steps: run.steps.map((s: any) => ({
          stepNumber: s.stepNumber,
          instruction: s.instruction,
          status: s.status,
          result: s.result,
          durationMs: s.durationMs,
          errorMessage: s.errorMessage,
          retryCount: s.retryCount,
          screenshot: s.screenshot,
        })),
        visualDiffs: run.visualDiffs?.map((d: any) => ({
          stepNumber: d.stepNumber,
          similarity: d.similarity,
          approved: d.approved,
          baselinePath: d.baselinePath,
          currentPath: d.currentPath,
        })),
      },
      null,
      2,
    );
  }

  /**
   * Export as PDF
   */
  private async exportPDF(run: any, options: ExportOptions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const buffers: Buffer[] = [];

        doc.on("data", (data: Buffer) => buffers.push(data));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", reject);

        // Header
        doc.fontSize(24).font("Helvetica-Bold").text("E2E Test Report");
        doc.moveDown();

        // Test Info
        doc.fontSize(12).font("Helvetica-Bold").text("Test Information");
        doc.fontSize(10).font("Helvetica");
        doc.text(`Name: ${run.test.name}`);
        doc.text(`Status: ${run.status.toUpperCase()}`);
        doc.text(`Duration: ${(run.durationMs / 1000).toFixed(2)}s`);
        doc.text(`Cost: $${run.costUsd.toFixed(4)}`);
        doc.text(`Date: ${new Date(run.startedAt).toLocaleString()}`);
        doc.moveDown();

        // Steps
        doc.fontSize(12).font("Helvetica-Bold").text("Test Steps");
        doc.fontSize(10).font("Helvetica");

        for (const step of run.steps) {
          const statusSymbol = step.status === "passed" ? "✓" : "✗";
          doc.text(`${statusSymbol} Step ${step.stepNumber}: ${step.instruction}`);
          if (step.result) {
            doc.text(`  Result: ${step.result}`, { indent: 20 });
          }
          if (step.errorMessage) {
            doc.fillColor("red").text(`  Error: ${step.errorMessage}`, { indent: 20 });
            doc.fillColor("black");
          }
          doc.text(`  Duration: ${step.durationMs}ms`, { indent: 20 });
        }

        doc.moveDown();

        // Visual Regression
        if (run.visualDiffs && run.visualDiffs.length > 0) {
          doc.fontSize(12).font("Helvetica-Bold").text("Visual Regression Results");
          doc.fontSize(10).font("Helvetica");

          for (const diff of run.visualDiffs) {
            const status = diff.approved ? "Approved" : "Pending";
            doc.text(
              `Step ${diff.stepNumber}: ${(diff.similarity * 100).toFixed(1)}% similarity (${status})`,
            );
          }
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Export as HTML
   */
  private exportHTML(run: any, options: ExportOptions): string {
    const passedSteps = run.steps.filter((s: any) => s.status === "passed").length;
    const totalSteps = run.steps.length;
    const passRate = ((passedSteps / totalSteps) * 100).toFixed(1);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E2E Test Report - ${run.test.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; }
    .header h1 { font-size: 32px; margin-bottom: 10px; }
    .header .meta { display: flex; gap: 20px; font-size: 14px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; }
    .status-badge.passed { background: #22c55e; color: white; }
    .status-badge.failed { background: #ef4444; color: white; }
    .section { margin-bottom: 30px; }
    .section h2 { font-size: 20px; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #e5e7eb; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .metric-card { background: #f9fafb; padding: 15px; border-radius: 6px; border-left: 4px solid #667eea; }
    .metric-card .label { font-size: 12px; color: #666; text-transform: uppercase; }
    .metric-card .value { font-size: 24px; font-weight: bold; margin-top: 5px; }
    .step { background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 10px; border-left: 4px solid #e5e7eb; }
    .step.passed { border-left-color: #22c55e; }
    .step.failed { border-left-color: #ef4444; }
    .step-title { font-weight: bold; display: flex; align-items: center; gap: 8px; }
    .step-icon { font-size: 18px; }
    .step-detail { margin-top: 8px; margin-left: 26px; font-size: 13px; color: #666; }
    .step-error { color: #ef4444; margin-top: 8px; padding: 8px; background: #fee; border-radius: 4px; margin-left: 26px; }
    .visual-diff { background: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 10px; }
    .visual-diff-title { font-weight: bold; margin-bottom: 5px; }
    .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin-top: 10px; }
    .progress-fill { height: 100%; background: #22c55e; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #f3f4f6; padding: 10px; text-align: left; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${run.test.name}</h1>
      <div class="meta">
        <span class="status-badge ${run.status}">${run.status.toUpperCase()}</span>
        <span>Execution Date: ${new Date(run.startedAt).toLocaleString()}</span>
      </div>
    </div>

    <div class="section">
      <h2>Summary</h2>
      <div class="metrics">
        <div class="metric-card">
          <div class="label">Status</div>
          <div class="value">${run.status.toUpperCase()}</div>
        </div>
        <div class="metric-card">
          <div class="label">Duration</div>
          <div class="value">${(run.durationMs / 1000).toFixed(2)}s</div>
        </div>
        <div class="metric-card">
          <div class="label">Cost</div>
          <div class="value">$${run.costUsd.toFixed(4)}</div>
        </div>
        <div class="metric-card">
          <div class="label">Pass Rate</div>
          <div class="value">${passRate}%</div>
        </div>
      </div>
      <div>
        <strong>Steps: ${passedSteps}/${totalSteps} passed</strong>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${passRate}%"></div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Test Steps</h2>
      ${run.steps
        .map(
          (step: any) => `
        <div class="step ${step.status}">
          <div class="step-title">
            <span class="step-icon">${step.status === "passed" ? "✓" : "✗"}</span>
            Step ${step.stepNumber}: ${step.instruction}
          </div>
          ${step.result ? `<div class="step-detail"><strong>Result:</strong> ${step.result}</div>` : ""}
          <div class="step-detail"><strong>Duration:</strong> ${step.durationMs}ms</div>
          ${step.retryCount ? `<div class="step-detail"><strong>Retries:</strong> ${step.retryCount}</div>` : ""}
          ${step.errorMessage ? `<div class="step-error"><strong>Error:</strong> ${step.errorMessage}</div>` : ""}
        </div>
      `,
        )
        .join("")}
    </div>

    ${
      run.visualDiffs && run.visualDiffs.length > 0
        ? `
    <div class="section">
      <h2>Visual Regression</h2>
      <table>
        <tr>
          <th>Step</th>
          <th>Similarity</th>
          <th>Status</th>
        </tr>
        ${run.visualDiffs
          .map(
            (diff: any) => `
          <tr>
            <td>Step ${diff.stepNumber}</td>
            <td>${(diff.similarity * 100).toFixed(1)}%</td>
            <td>${diff.approved ? "Approved" : "Pending Review"}</td>
          </tr>
        `,
          )
          .join("")}
      </table>
    </div>
    `
        : ""
    }

    <div class="footer">
      Generated on ${new Date().toLocaleString()} | E2E Test Report
    </div>
  </div>
</body>
</html>
    `;
  }

  /**
   * Export test history as PDF
   */
  private async exportHistoryPDF(test: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const buffers: Buffer[] = [];

        doc.on("data", (data: Buffer) => buffers.push(data));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", reject);

        // Header
        doc.fontSize(24).font("Helvetica-Bold").text(`${test.name} - Test History`);
        doc.moveDown();

        // Summary
        const passRate = this.calculatePassRate(test.runs);
        doc.fontSize(12).font("Helvetica-Bold").text("Summary");
        doc.fontSize(10).font("Helvetica");
        doc.text(`Total Runs: ${test.runs.length}`);
        doc.text(`Pass Rate: ${(passRate * 100).toFixed(1)}%`);
        doc.moveDown();

        // Run details
        doc.fontSize(12).font("Helvetica-Bold").text("Recent Runs");
        doc.fontSize(9).font("Helvetica");

        for (const run of test.runs) {
          const date = new Date(run.startedAt).toLocaleDateString();
          const duration = (run.durationMs / 1000).toFixed(2);
          const status = run.status.toUpperCase();

          doc.text(`[${status}] ${date} - ${duration}s - $${run.costUsd?.toFixed(4) || "0.00"}`);
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Export test history as HTML
   */
  private exportHistoryHTML(test: any): string {
    const passRate = this.calculatePassRate(test.runs);
    const totalPassed = test.runs.filter((r: any) => r.status === "passed").length;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test History - ${test.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #333; padding: 20px; }
    .container { max-width: 1000px; margin: 0 auto; }
    h1 { color: #667eea; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
    .summary-card { background: #f9fafb; padding: 15px; border-radius: 6px; text-align: center; }
    .summary-card .value { font-size: 24px; font-weight: bold; color: #667eea; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #f3f4f6; padding: 12px; text-align: left; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    tr:hover { background: #f9fafb; }
    .status-passed { color: #22c55e; font-weight: bold; }
    .status-failed { color: #ef4444; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${test.name} - Test History</h1>
    
    <div class="summary">
      <div class="summary-card">
        <div>Total Runs</div>
        <div class="value">${test.runs.length}</div>
      </div>
      <div class="summary-card">
        <div>Passed</div>
        <div class="value" style="color: #22c55e;">${totalPassed}</div>
      </div>
      <div class="summary-card">
        <div>Failed</div>
        <div class="value" style="color: #ef4444;">${test.runs.length - totalPassed}</div>
      </div>
      <div class="summary-card">
        <div>Pass Rate</div>
        <div class="value">${(passRate * 100).toFixed(1)}%</div>
      </div>
    </div>

    <table>
      <tr>
        <th>Date</th>
        <th>Status</th>
        <th>Duration</th>
        <th>Cost</th>
        <th>Steps</th>
      </tr>
      ${test.runs
        .map(
          (run: any) => `
        <tr>
          <td>${new Date(run.startedAt).toLocaleString()}</td>
          <td><span class="status-${run.status}">${run.status.toUpperCase()}</span></td>
          <td>${(run.durationMs / 1000).toFixed(2)}s</td>
          <td>$${run.costUsd?.toFixed(4) || "0.00"}</td>
          <td>${run.steps?.length || 0}</td>
        </tr>
      `,
        )
        .join("")}
    </table>
  </div>
</body>
</html>
    `;
  }

  /**
   * Calculate pass rate from runs
   */
  private calculatePassRate(runs: any[]): number {
    if (runs.length === 0) return 0;
    const passed = runs.filter((r) => r.status === "passed").length;
    return passed / runs.length;
  }
}
