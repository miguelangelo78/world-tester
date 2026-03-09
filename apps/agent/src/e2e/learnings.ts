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
  // Validate domain - skip if it's an invalid/internal domain
  if (!domain || domain === "unknown" || domain.startsWith("chrome") || domain === "chromewebdata") {
    console.warn(`[E2E Learnings] Skipping learning tagging for invalid domain: ${domain}`);
    return;
  }

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
 * Get all learnings for a domain (both E2E and general learnings)
 * These are used to improve test generation and execution
 */
export async function getDomainLearnings(
  prisma: PrismaClient,
  domain: string,
): Promise<
  Array<{
    pattern: string;
    category: string;
    confidence: number;
    source: "e2e" | "general";
  }>
> {
  const learnings = await prisma.learning.findMany({
    where: { domain },
    orderBy: [{ confidence: "desc" }, { created: "desc" }],
  });

  return learnings.map((l) => ({
    pattern: l.pattern,
    category: l.category,
    confidence: l.confidence,
    source: l.sourceTaskId?.startsWith("e2e-") ? "e2e" : "general",
  }));
}

/**
 * Format learnings into a readable context string for AI
 */
export function formatLearningsContext(
  learnings: Array<{
    pattern: string;
    category: string;
    confidence: number;
    source: "e2e" | "general";
  }>
): string {
  if (learnings.length === 0) {
    return "";
  }

  const byCategory: Record<string, typeof learnings> = {};
  for (const learning of learnings) {
    if (!byCategory[learning.category]) {
      byCategory[learning.category] = [];
    }
    byCategory[learning.category].push(learning);
  }

  let context =
    "## Known patterns for this domain (from past successful tests):\n\n";

  for (const [category, items] of Object.entries(byCategory)) {
    context += `### ${category.charAt(0).toUpperCase() + category.slice(1)}:\n`;
    for (const item of items.slice(0, 5)) {
      // Show top 5 per category
      const icon = item.source === "e2e" ? "🤖" : "👤";
      const confidence = Math.round(item.confidence * 100);
      context += `- ${icon} ${item.pattern} (confidence: ${confidence}%)\n`;
    }
    context += "\n";
  }

  return context;
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
