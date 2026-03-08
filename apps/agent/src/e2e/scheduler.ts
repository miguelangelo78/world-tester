import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
import { AgentCore } from "../core.js";
import { executeE2ETest, saveTestRun } from "./runner.js";
import { NotificationDispatcher } from "./notifications.js";
import type { OutputSink } from "../output-sink.js";
import * as display from "../cli/display.js";

export interface SchedulerConfig {
  enabled: boolean;
  maxConcurrentTests: number;
  retryFailedTests: boolean;
  notificationWebhook?: string;
}

/**
 * E2E Test Scheduler - Manages cron-based test execution
 * Runs tests on schedules, tracks history, sends notifications
 */
export class E2EScheduler {
  private cronTasks: Map<string, string> = new Map(); // jobId -> cron task
  private activeRuns: Map<string, Promise<any>> = new Map(); // runId -> promise
  private prisma: PrismaClient;
  private core: AgentCore;
  private config: SchedulerConfig;
  private sink?: OutputSink;
  private notificationDispatcher: NotificationDispatcher;

  constructor(prisma: PrismaClient, core: AgentCore, config?: SchedulerConfig, sink?: OutputSink) {
    this.prisma = prisma;
    this.core = core;
    this.sink = sink;
    this.config = config || {
      enabled: true,
      maxConcurrentTests: 2,
      retryFailedTests: true,
    };
    this.notificationDispatcher = new NotificationDispatcher();
  }

  /**
   * Start the scheduler - load jobs from DB and initialize cron tasks
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.sink?.info("E2E Scheduler is disabled");
      return;
    }

    this.sink?.info("Starting E2E Scheduler...");

    // Load all enabled scheduled jobs
    const jobs = await this.prisma.e2EScheduledJob.findMany({
      where: { enabled: true },
      include: { test: true },
    });

    for (const job of jobs) {
      try {
        this.scheduleTest(job);
        this.sink?.info(`Scheduled: ${job.test.name} (${job.cronSchedule})`);
      } catch (err) {
        this.sink?.warn(`Failed to schedule ${job.test.name}: ${err}`);
      }
    }

    this.sink?.info(`E2E Scheduler started with ${jobs.length} jobs`);
  }

  /**
   * Stop the scheduler - clean up all cron tasks
   */
  async stop(): Promise<void> {
    this.sink?.info("Stopping E2E Scheduler...");

    // Cancel all cron tasks
    for (const [, taskStr] of this.cronTasks) {
      try {
        cron.validate(taskStr);
        // Note: node-cron doesn't provide a direct stop method for individual tasks
        // We'll track them separately and gracefully exit
      } catch (err) {
        // Task already stopped or invalid
      }
    }

    this.cronTasks.clear();
    this.sink?.info("E2E Scheduler stopped");
  }

  /**
   * Schedule a single test
   */
  private scheduleTest(job: any): void {
    // Validate cron expression
    if (!cron.validate(job.cronSchedule)) {
      throw new Error(`Invalid cron expression: ${job.cronSchedule}`);
    }

    // Create cron task
    const task = cron.schedule(job.cronSchedule, () => this.executeScheduledTest(job));

    this.cronTasks.set(job.id, job.cronSchedule);

    // Update next run time
    const now = new Date();
    const nextRun = this.getNextRunTime(job.cronSchedule, now);
    this.prisma.e2EScheduledJob
      .update({
        where: { id: job.id },
        data: { nextRunAt: nextRun, lastRunAt: now },
      })
      .catch((err) => this.sink?.warn(`Failed to update next run time: ${err}`));
  }

  /**
   * Execute a scheduled test
   */
  private async executeScheduledTest(job: any): Promise<void> {
    // Check if we're at max concurrent tests
    if (this.activeRuns.size >= this.config.maxConcurrentTests) {
      this.sink?.warn(`Max concurrent tests (${this.config.maxConcurrentTests}) reached, skipping ${job.test.name}`);
      return;
    }

    try {
      this.sink?.info(`[SCHEDULED] Starting: ${job.test.name} (${job.cronSchedule})`);

      // Create test run
      const run = await this.prisma.e2ETestRun.create({
        data: {
          testId: job.testId,
          status: "running",
          isScheduled: true,
          scheduledJobId: job.id,
        },
      });

      // Execute test
      const runPromise = this.executeTestWithNotification(job, run);
      this.activeRuns.set(run.id, runPromise);

      // Wait for completion
      await runPromise;

      // Remove from active runs
      this.activeRuns.delete(run.id);

      // Update job's last run time
      const nextRun = this.getNextRunTime(job.cronSchedule, new Date());
      await this.prisma.e2EScheduledJob.update({
        where: { id: job.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: nextRun,
        },
      });
    } catch (err) {
      this.sink?.warn(`Error executing scheduled test ${job.test.name}: ${err}`);
    }
  }

  /**
   * Execute test and send notification
   */
  private async executeTestWithNotification(job: any, run: any): Promise<void> {
    const startTime = Date.now();
    let result: any = null;

    try {
      const test = job.test;
      const stagehand = this.core.pool.active().stagehand;

      result = await executeE2ETest(
        test.definition,
        stagehand,
        this.core.config,
        this.core.memory,
        this.core.costTracker,
        this.prisma,
        run.id,
        test.id,
        this.sink,
      );

      const pages = stagehand.context?.pages?.();
      const domain = pages?.[0] ? new URL(pages[0].url()).hostname : "unknown";
      await saveTestRun(this.prisma, this.core.memory, result, test.name, domain);

      // Record run result
      const durationMs = Date.now() - startTime;
      await this.prisma.e2ETestRun.update({
        where: { id: run.id },
        data: {
          status: result.status === "passed" ? "passed" : "failed",
          verdict: result.status,
          completedAt: new Date(),
          durationMs,
          costUsd: result.costUsd,
        },
      });

      this.sink?.info(`[SCHEDULED] Completed: ${job.test.name} — ${result.status.toUpperCase()}`);

      // Send notification
      if (result.status === "failed") {
        await this.sendNotification(job, result, durationMs);
      }
    } catch (err) {
      const durationMs = Date.now() - startTime;
      this.sink?.warn(`[SCHEDULED] Failed: ${job.test.name} — ${err}`);

      // Update run with error
      await this.prisma.e2ETestRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          verdict: "failed",
          completedAt: new Date(),
          durationMs,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });

      // Send error notification
      await this.sendNotification(job, { error: String(err) }, durationMs);
    }
  }

  /**
   * Send notification for test result
   */
  private async sendNotification(job: any, result: any, durationMs: number): Promise<void> {
    const notification = job.notificationConfig || {};

    // Skip if notifications disabled
    if (!notification.emailEnabled && !notification.slackEnabled && !notification.webhookEnabled) {
      return;
    }

    try {
      const passedSteps = result.steps?.filter((s: any) => s.status === "passed").length || 0;
      const totalSteps = result.steps?.length || 0;

      await this.notificationDispatcher.notifyTestResult(
        job.testId,
        job.test.name,
        result.status === "passed" ? "passed" : "failed",
        notification,
        {
          duration: durationMs,
          cost: result.costUsd,
          error: result.error,
          passedSteps,
          totalSteps,
          runId: result.runId,
          runUrl: `http://localhost:3100/api/e2e/runs/${result.runId}`, // Customize as needed
        },
      );
    } catch (err) {
      this.sink?.warn(`Failed to send notification for ${job.test.name}: ${err}`);
    }
  }

  /**
   * Calculate next run time based on cron expression
   */
  private getNextRunTime(cronExpression: string, from: Date): Date {
    try {
      // Parse cron and find next execution time
      const task = cron.schedule(cronExpression, () => {});
      // node-cron doesn't expose next run time directly
      // This is a simplified calculation; consider using cron-parser for production
      const next = new Date(from);
      next.setMinutes(next.getMinutes() + 1);
      return next;
    } catch {
      return new Date(from.getTime() + 60000); // Default: 1 minute from now
    }
  }

  /**
   * Get scheduler status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    activeRuns: number;
    scheduledJobs: number;
    nextRunTimes: Array<{
      testName: string;
      schedule: string;
      nextRunAt: Date;
    }>;
  }> {
    const jobs = await this.prisma.e2EScheduledJob.findMany({
      where: { enabled: true },
      include: { test: true },
    });

    return {
      enabled: this.config.enabled,
      activeRuns: this.activeRuns.size,
      scheduledJobs: jobs.length,
      nextRunTimes: jobs.map((j) => ({
        testName: j.test.name,
        schedule: j.cronSchedule,
        nextRunAt: j.nextRunAt || new Date(),
      })),
    };
  }

  /**
   * Pause a scheduled job
   */
  async pauseJob(jobId: string): Promise<void> {
    await this.prisma.e2EScheduledJob.update({
      where: { id: jobId },
      data: { enabled: false },
    });
    this.cronTasks.delete(jobId);
    this.sink?.info(`Paused scheduled job: ${jobId}`);
  }

  /**
   * Resume a scheduled job
   */
  async resumeJob(jobId: string): Promise<void> {
    const job = await this.prisma.e2EScheduledJob.findUnique({
      where: { id: jobId },
      include: { test: true },
    });

    if (!job) throw new Error("Job not found");

    await this.prisma.e2EScheduledJob.update({
      where: { id: jobId },
      data: { enabled: true },
    });

    this.scheduleTest(job);
    this.sink?.info(`Resumed scheduled job: ${jobId}`);
  }

  /**
   * Delete a scheduled job
   */
  async deleteJob(jobId: string): Promise<void> {
    await this.pauseJob(jobId);
    await this.prisma.e2EScheduledJob.delete({
      where: { id: jobId },
    });
    this.sink?.info(`Deleted scheduled job: ${jobId}`);
  }
}

/**
 * Global scheduler instance
 */
let scheduler: E2EScheduler | null = null;

/**
 * Initialize the global scheduler
 */
export function initializeScheduler(
  prisma: PrismaClient,
  core: AgentCore,
  config?: SchedulerConfig,
  sink?: OutputSink,
): E2EScheduler {
  scheduler = new E2EScheduler(prisma, core, config, sink);
  return scheduler;
}

/**
 * Get the global scheduler instance
 */
export function getScheduler(): E2EScheduler | null {
  return scheduler;
}
