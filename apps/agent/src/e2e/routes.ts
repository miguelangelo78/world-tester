import { Router } from "express";
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import { AgentCore } from "../core.js";
import { executeE2ETest, saveTestRun } from "./runner.js";
import { TestResultExporter } from "./export.js";
import { generateE2ESteps } from "./generate-steps.js";

// Helper to extract single query param value
function getQueryParam(value: any): string | undefined {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;
  return undefined;
}

export function createE2ERouter(core: AgentCore, prisma: PrismaClient): Router {
  const router = Router();

  // Create a new e2e test
  router.post("/tests", async (req: Request, res: Response) => {
    try {
      const { 
        name, 
        description, 
        domain,
        definition, 
        steps,
        scope, 
        retryCount, 
        strictnessLevel, 
        visualRegressionEnabled,
        autoApproveBaseline,
        notificationConfig 
      } = req.body;

      // Validate domain is provided
      if (!domain) {
        return res.status(400).json({ error: "Domain is required" });
      }

      // Build the definition object with all test data
      // Normalize steps to be just instruction strings
      const normalizedSteps = Array.isArray(steps) 
        ? steps.map((step: any) => typeof step === "string" ? step : step.instruction || "")
        : [];
      
      const testDefinition = {
        name: name || "Unnamed Test",
        description: description || "",
        retryCount: retryCount || 2,
        strictnessLevel: strictnessLevel || "medium",
        visualRegressionEnabled: visualRegressionEnabled !== false,
        autoApproveBaseline: autoApproveBaseline || false,
        notificationConfig: notificationConfig || {},
        ...definition, // Merge any additional definition data
        steps: normalizedSteps, // Override with normalized steps (must be last)
      };

      const test = await prisma.e2ETest.create({
        data: {
          name: name || "Unnamed Test",
          description: description || "",
          domain: domain,
          definition: testDefinition as any,
          scope: scope || "global",
          retryCount: retryCount || 2,
          strictnessLevel: strictnessLevel || "medium",
          visualRegressionEnabled: visualRegressionEnabled !== false,
          autoApproveBaseline: autoApproveBaseline || false,
        },
      });

      res.json(test);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get all tests
  router.get("/tests", async (req: Request, res: Response) => {
    try {
      const scope = getQueryParam(req.query.scope);
      const domain = getQueryParam(req.query.domain);
      
      const where: any = {};
      if (scope) where.scope = scope;
      if (domain) where.domain = domain;
      
      const tests = await prisma.e2ETest.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        include: { 
          _count: { select: { runs: true } },
          runs: {
            take: 1,
            orderBy: { startedAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      
      // Enrich tests with steps and latest run data
      const enrichedTests = await Promise.all(tests.map(async (test) => {
        // Calculate stats from recent runs
        const recentRuns = await prisma.e2ETestRun.findMany({
          where: { testId: test.id },
          take: 20,
          orderBy: { startedAt: "desc" },
        });

        const passedRuns = recentRuns.filter(r => r.status === "passed").length;
        const passRate = recentRuns.length > 0 ? passedRuns / recentRuns.length : 0;
        const avgDuration = recentRuns.length > 0 
          ? recentRuns.reduce((sum, r) => sum + (r.durationMs || 0), 0) / recentRuns.length 
          : 0;
        const avgCost = recentRuns.length > 0 
          ? recentRuns.reduce((sum, r) => sum + r.costUsd, 0) / recentRuns.length 
          : 0;

        // Calculate total cost from ALL runs for this test
        const allRuns = await prisma.e2ETestRun.findMany({
          where: { testId: test.id },
        });
        const totalCost = allRuns.reduce((sum, r) => sum + r.costUsd, 0);

        return {
          ...test,
          steps: (test.definition as any)?.steps || [],
          passRate,
          totalRuns: test._count.runs,
          averageCost: avgCost,
          totalCost: totalCost,
          averageDuration: avgDuration,
          lastRun: test.runs[0] ? {
            status: test.runs[0].status as "passed" | "failed" | "running",
            date: new Date(test.runs[0].startedAt).toLocaleString(),
            durationMs: test.runs[0].durationMs || 0,
            cost: test.runs[0].costUsd,
          } : undefined,
        };
      }));
      
      res.json(enrichedTests);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get single test with recent runs
  router.get("/tests/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const test = await prisma.e2ETest.findUnique({
        where: { id },
        include: {
          runs: {
            take: 10,
            orderBy: { startedAt: "desc" },
            include: { steps: true },
          },
        },
      });

      if (!test) return res.status(404).json({ error: "Test not found" });
      
      // Ensure the response includes steps from the definition
      const enrichedTest = {
        ...test,
        steps: (test.definition as any)?.steps || [],
      };
      
      res.json(enrichedTest);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update test
  router.put("/tests/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const { 
        name, 
        description, 
        domain,
        definition, 
        steps,
        retryCount, 
        strictnessLevel, 
        visualRegressionEnabled, 
        cronSchedule,
        notificationConfig,
        autoApproveBaseline
      } = req.body;

      // Create a new version
      const currentTest = await prisma.e2ETest.findUnique({ where: { id } });
      if (!currentTest) return res.status(404).json({ error: "Test not found" });

      await prisma.e2ETestVersion.create({
        data: {
          testId: id,
          version: currentTest.versionNumber,
          definition: currentTest.definition as any,
        },
      });

      // Build the definition object - preserve all test data
      // Normalize steps to be just instruction strings
      const normalizedSteps = Array.isArray(steps) 
        ? steps.map((step: any) => typeof step === "string" ? step : step.instruction || "")
        : [];
      
      const testDefinition = {
        name: name || currentTest.name,
        description: description ?? (currentTest.description || ""),
        retryCount: retryCount !== undefined ? retryCount : (currentTest.retryCount || 2),
        strictnessLevel: strictnessLevel || (currentTest.strictnessLevel || "medium"),
        visualRegressionEnabled: visualRegressionEnabled !== undefined ? visualRegressionEnabled : currentTest.visualRegressionEnabled,
        autoApproveBaseline: autoApproveBaseline !== undefined ? autoApproveBaseline : currentTest.autoApproveBaseline,
        cronSchedule: cronSchedule || undefined,
        notificationConfig: notificationConfig || {},
        ...definition, // Merge any additional definition data
        steps: normalizedSteps, // Override with normalized steps (must be last)
      };

      const updated = await prisma.e2ETest.update({
        where: { id },
        data: {
          name: name || currentTest.name,
          description: description ?? (currentTest.description || ""),
          domain: domain || currentTest.domain,
          definition: testDefinition as any,
          retryCount: retryCount !== undefined ? retryCount : currentTest.retryCount,
          strictnessLevel: strictnessLevel || currentTest.strictnessLevel,
          visualRegressionEnabled: visualRegressionEnabled !== undefined ? visualRegressionEnabled : currentTest.visualRegressionEnabled,
          autoApproveBaseline: autoApproveBaseline !== undefined ? autoApproveBaseline : currentTest.autoApproveBaseline,
          cronSchedule: cronSchedule || currentTest.cronSchedule,
          versionNumber: currentTest.versionNumber + 1,
          updatedAt: new Date(),
        },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete test
  router.delete("/tests/:id", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      
      const test = await prisma.e2ETest.findUnique({ where: { id } });
      if (!test) return res.status(404).json({ error: "Test not found" });

      // Delete the test (cascade delete will handle runs and steps)
      await prisma.e2ETest.delete({ where: { id } });

      res.json({ success: true, message: "Test deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Run test manually
  router.post("/tests/:id/run", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const test = await prisma.e2ETest.findUnique({ where: { id } });

      if (!test) return res.status(404).json({ error: "Test not found" });

      // Validate test has steps
      const definition = test.definition as any;
      if (!definition.steps || !Array.isArray(definition.steps) || definition.steps.length === 0) {
        return res.status(400).json({ error: "Test has no steps defined. Please add steps before running." });
      }

      // Create run record first
      const run = await prisma.e2ETestRun.create({
        data: { testId: id, status: "running" },
      });

      // Create a dedicated browser instance for this E2E test run (use run ID for unique names)
      const e2eBrowser = await core.pool.spawn(`e2e-${run.id}`);
      const stagehand = e2eBrowser.stagehand;

      // Log test details for debugging
      console.log(`[E2E] Starting test run: ${test.name} (${id})`);
      console.log(`[E2E] Steps: ${(definition.steps as string[]).length}`, definition.steps);

      // Execute in background
      (async () => {
        try {
          const result = await executeE2ETest(
            test.definition,
            stagehand,
            core.config,
            core.memory,
            core.costTracker,
            prisma,
            run.id,
            test.id, // Pass testId
            test.domain, // Pass domain for homepage navigation
            undefined, // sink
            undefined, // signal
          );

          // Log detailed failure info
          if (result.status === "failed") {
            const failedSteps = result.steps.filter((s) => s.status === "failed");
            const failureReasons = failedSteps.map((s) => `Step ${s.stepNumber}: ${s.error || "Unknown error"}`).join(" | ");
            console.log(`[E2E] Test run completed: ${result.status}. Steps executed: ${result.steps.length}. Failures: ${failureReasons}`);
            
            // If test was incomplete without failed steps, log the abort reason
            if (failedSteps.length === 0 && result.abortMessage) {
              console.log(`[E2E] ${result.abortMessage}`);
            }
          } else {
            console.log(`[E2E] Test run completed: ${result.status}. Steps executed: ${result.steps.length}`);
          }
          
          const domain = new URL(stagehand.context.pages()[0].url()).hostname;
          await saveTestRun(prisma, core.memory, result, test.name, domain);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[E2E] Test run failed:`, errorMsg);
          await prisma.e2ETestRun.update({
            where: { id: run.id },
            data: {
              status: "failed",
              errorMessage: errorMsg,
              completedAt: new Date(),
            },
          });
        } finally {
          // Close the dedicated E2E browser instance
          try {
            await e2eBrowser.close();
            console.log(`[E2E] Closed browser instance for test ${id}`);
          } catch (closeErr) {
            console.error(`[E2E] Error closing browser instance:`, closeErr);
          }
        }
      })();

      res.json({ runId: run.id, status: "running" });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get test run with steps
  router.get("/runs/:runId", async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const run = await prisma.e2ETestRun.findUnique({
        where: { id: runId },
        include: { steps: true, visualDiffs: true },
      });

      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get test history/results
  router.get("/tests/:id/results", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const limitStr = getQueryParam(req.query.limit);
      const limit = limitStr ? parseInt(limitStr) : 50;

      const test = await prisma.e2ETest.findUnique({ where: { id } });
      if (!test) return res.status(404).json({ error: "Test not found" });

      const runs = await prisma.e2ETestRun.findMany({
        where: { testId: id },
        take: limit,
        orderBy: { startedAt: "desc" },
        include: { 
          steps: true,
          visualDiffs: true,
        },
      });

      // Enrich runs with test info
      const enrichedRuns = runs.map((run) => ({
        ...run,
        test: {
          name: test.name,
          description: test.description,
        },
      }));

      res.json(enrichedRuns);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Approve visual baseline
  router.post("/baselines/:testId/:stepNumber/approve", async (req: Request, res: Response) => {
    try {
      const testId = String(req.params.testId);
      const stepNumber = parseInt(String(req.params.stepNumber));

      const baseline = await prisma.e2EVisualBaseline.update({
        where: { testId_stepNumber: { testId, stepNumber } },
        data: { approvedAt: new Date(), approvedBy: "user" },
      });

      res.json(baseline);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Schedule a test
  router.post("/schedules", async (req: Request, res: Response) => {
    try {
      const { testId, cronSchedule, notificationConfig } = req.body;

      if (!testId || !cronSchedule) {
        return res.status(400).json({ error: "testId and cronSchedule required" });
      }

      const schedule = await prisma.e2EScheduledJob.create({
        data: {
          testId,
          cronSchedule,
          notificationConfig: notificationConfig || {},
          enabled: true,
        },
        include: { test: true },
      });

      res.status(201).json(schedule);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get all schedules
  router.get("/schedules", async (req: Request, res: Response) => {
    try {
      const schedules = await prisma.e2EScheduledJob.findMany({
        include: { test: true },
        orderBy: { nextRunAt: "asc" },
      });

      res.json(schedules);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get a schedule
  router.get("/schedules/:jobId", async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId);
      const schedule = await prisma.e2EScheduledJob.findUnique({
        where: { id: jobId },
        include: { test: true },
      });

      if (!schedule) return res.status(404).json({ error: "Schedule not found" });

      res.json(schedule);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Update a schedule
  router.put("/schedules/:jobId", async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId);
      const { cronSchedule, notificationConfig, enabled } = req.body;

      const updated = await prisma.e2EScheduledJob.update({
        where: { id: jobId },
        data: {
          ...(cronSchedule && { cronSchedule }),
          ...(notificationConfig && { notificationConfig: notificationConfig as any }),
          ...(enabled !== undefined && { enabled }),
        },
        include: { test: true },
      });

      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Delete a schedule
  router.delete("/schedules/:jobId", async (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.jobId);

      await prisma.e2EScheduledJob.delete({
        where: { id: jobId },
      });

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get scheduler status
  router.get("/scheduler/status", async (req: Request, res: Response) => {
    try {
      const { getScheduler } = await import("./scheduler.js");
      const scheduler = getScheduler();

      if (!scheduler) {
        return res.status(503).json({ error: "Scheduler not initialized" });
      }

      const status = await scheduler.getStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Export test run
  router.get("/runs/:runId/export", async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const format = (getQueryParam(req.query.format) as "json" | "pdf" | "html") || "json";

      const exporter = new TestResultExporter(prisma);
      const result = await exporter.exportRun(runId, format);

      if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="test-run-${runId.slice(0, 8)}.pdf"`);
        res.send(result);
      } else if (format === "html") {
        res.setHeader("Content-Type", "text/html");
        res.send(result);
      } else {
        res.setHeader("Content-Type", "application/json");
        res.send(result);
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get all unique domains
  router.get("/domains", async (req: Request, res: Response) => {
    try {
      const tests = await prisma.e2ETest.findMany({
        select: { domain: true },
        distinct: ["domain"],
        orderBy: { domain: "asc" },
      });

      const domains = tests.map(t => t.domain).filter(Boolean);
      res.json({ domains });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Export test history
  router.get("/tests/:id/export", async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const format = (getQueryParam(req.query.format) as "json" | "pdf" | "html") || "json";
      const limitStr = getQueryParam(req.query.limit);
      const limit = limitStr ? parseInt(limitStr) : 50;

      const exporter = new TestResultExporter(prisma);
      const result = await exporter.exportTestHistory(id, format, limit);

      if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="test-history-${id.slice(0, 8)}.pdf"`);
        res.send(result);
      } else if (format === "html") {
        res.setHeader("Content-Type", "text/html");
        res.send(result);
      } else {
        res.setHeader("Content-Type", "application/json");
        res.send(result);
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Generate test steps using AI
  router.post("/generate-steps", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const steps = await generateE2ESteps(prompt);
      res.json({ steps });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Get screenshot for a test step
  router.get("/steps/:runId/:stepNumber/screenshot", async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const stepNumber = parseInt(String(req.params.stepNumber));
      const type = getQueryParam(req.query.type) || "after"; // "before" or "after"

      // Get the step to find the screenshot path
      const step = await prisma.e2ETestStep.findFirst({
        where: { runId, stepNumber },
      });

      if (!step || !step.screenshot) {
        return res.status(404).json({ error: "Screenshot not found in database" });
      }

      let screenshotPath: string;
      
      // The stored path is the "after" screenshot
      // We need to construct paths for both before and after
      if (type === "before") {
        // Convert "after" path to "before" path
        // From: /tmp/e2e-{runId}-step{stepNumber}.png
        // To: /tmp/e2e-{runId}-step{stepNumber}-before.png
        screenshotPath = step.screenshot.replace(/\.png$/, "-before.png");
      } else {
        // Use the stored path as-is (it's the "after" screenshot)
        screenshotPath = step.screenshot;
      }

      // Read the screenshot file
      try {
        const imageData = await fs.readFile(screenshotPath);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.setHeader("Content-Length", imageData.length);
        res.send(imageData);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[E2E] Failed to read screenshot file: ${screenshotPath}. Error: ${errorMsg}`);
        res.status(404).json({ error: `Screenshot (${type}) file not accessible: ${errorMsg}` });
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
