import { PrismaClient } from "@prisma/client";
import { MemoryManager } from "../memory/manager.js";
import { E2ERunResult } from "./runner.js";

/**
 * After a successful e2e test run, extract and tag learnings from the results.
 * These learnings are tagged with source="e2e_test_id" so the AI knows they came
 * from automated e2e tests and can prioritize them.
 */
export async function tagE2ELearnings(
  prisma: PrismaClient,
  memory: MemoryManager,
  testId: string,
  testName: string,
  runResult: E2ERunResult,
  domain: string,
): Promise<void> {
  // Only tag learnings from successful test runs
  if (runResult.status !== "passed") {
    return;
  }

  // Extract learnings from successful steps
  const learnings: Array<{
    pattern: string;
    category: "recipe" | "navigation" | "gotcha" | "general";
  }> = [];

  for (const step of runResult.steps) {
    if (step.status !== "passed" || !step.result) {
      continue;
    }

    // Navigation steps: extract URL patterns and flow information
    if (step.instruction.toLowerCase().includes("navigate")) {
      learnings.push({
        pattern: `Navigate: ${step.instruction} (e2e test: ${testName})`,
        category: "navigation",
      });
    }

    // Form filling: extract field patterns
    if (
      step.instruction.toLowerCase().includes("fill") ||
      step.instruction.toLowerCase().includes("enter")
    ) {
      learnings.push({
        pattern: `Form field: ${step.instruction} (e2e test: ${testName})`,
        category: "recipe",
      });
    }

    // Interactions: extract click/action patterns
    if (
      step.instruction.toLowerCase().includes("click") ||
      step.instruction.toLowerCase().includes("submit")
    ) {
      learnings.push({
        pattern: `Action: ${step.instruction} (e2e test: ${testName})`,
        category: "recipe",
      });
    }

    // Assertions: extract verification patterns
    if (step.instruction.toLowerCase().startsWith("assert")) {
      learnings.push({
        pattern: `Verification: ${step.instruction} (e2e test: ${testName})`,
        category: "general",
      });
    }
  }

  // Save learnings to the memory system
  for (const learning of learnings) {
    try {
      const id = `e2e-${testId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Create or update the learning
      await prisma.learning.upsert({
        where: {
          domain_pattern: {
            domain,
            pattern: learning.pattern,
          },
        },
        update: {
          confidence: Math.min(
            1.0,
            (Math.random() * 0.3 + 0.7), // e2e-derived learnings start with higher confidence (0.7-1.0)
          ),
        },
        create: {
          id,
          domain,
          category: learning.category,
          pattern: learning.pattern,
          confidence: Math.random() * 0.3 + 0.7, // Higher confidence for e2e learnings
          sourceTaskId: testId,
          created: new Date(),
        },
      });

      // Link the learning to the test run
      await prisma.e2ELearning.create({
        data: {
          learningId: id,
          testRunId: runResult.runId,
          testId,
        },
      });
    } catch (err) {
      // Log but don't fail if a single learning fails to save
      console.warn(`Failed to save learning for test ${testId}:`, err);
    }
  }

  console.log(`Tagged ${learnings.length} learnings from e2e test run ${runResult.runId}`);
}

/**
 * Get all learnings tagged from a specific e2e test
 */
export async function getE2ELearnings(
  prisma: PrismaClient,
  testId: string,
): Promise<any[]> {
  return prisma.e2ELearning.findMany({
    where: { testId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get statistics on e2e-derived learnings
 */
export async function getE2ELearningsStats(
  prisma: PrismaClient,
): Promise<{
  total: number;
  byCategory: Record<string, number>;
  byTestId: Record<string, number>;
  avgConfidence: number;
}> {
  const learnings = await prisma.learning.findMany({
    where: {
      sourceTaskId: { contains: "e2e-" },
    },
  });

  const byCategory: Record<string, number> = {
    navigation: 0,
    recipe: 0,
    gotcha: 0,
    general: 0,
  };

  for (const learning of learnings) {
    if (learning.category in byCategory) {
      byCategory[learning.category]++;
    }
  }

  // Get test ID breakdown
  const e2eLearnings = await prisma.e2ELearning.findMany();

  const byTestId: Record<string, number> = {};
  for (const e2eL of e2eLearnings) {
    const testName = e2eL.testId;
    byTestId[testName] = (byTestId[testName] || 0) + 1;
  }

  const avgConfidence =
    learnings.length > 0
      ? learnings.reduce((sum, l) => sum + l.confidence, 0) / learnings.length
      : 0;

  return {
    total: learnings.length,
    byCategory,
    byTestId,
    avgConfidence,
  };
}
