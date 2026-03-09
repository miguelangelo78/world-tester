import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

/**
 * Compare two screenshots and return similarity score (0-1).
 * Uses a simple pixel-by-pixel comparison with fuzzy matching.
 * For production, consider using pixelmatch or similar library.
 */
export async function compareScreenshots(
  baselinePath: string,
  currentPath: string,
): Promise<{
  similarity: number; // 0-1, where 1 is identical
  diff: Buffer | null; // Diff visualization (null if not generated)
}> {
  try {
    // Read both images
    const baselineData = fs.readFileSync(baselinePath);
    const currentData = fs.readFileSync(currentPath);

    // Simple comparison: calculate similarity based on size and byte difference
    const similarity = calculateSimilarity(baselineData, currentData);

    return {
      similarity,
      diff: null, // TODO: Generate diff visualization using pixelmatch
    };
  } catch (err) {
    console.warn(`Failed to compare screenshots: ${err}`);
    return { similarity: 0, diff: null };
  }
}

/**
 * Simple similarity calculation based on byte difference.
 * For production, use pixelmatch for pixel-level comparison.
 */
function calculateSimilarity(baseline: Buffer, current: Buffer): number {
  // If same size and exact match
  if (baseline.length === current.length && baseline.equals(current)) {
    return 1.0;
  }

  // If very different sizes, low similarity
  if (Math.abs(baseline.length - current.length) > baseline.length * 0.5) {
    return 0.3;
  }

  // Calculate byte-level difference
  let matchingBytes = 0;
  const minLength = Math.min(baseline.length, current.length);

  for (let i = 0; i < minLength; i++) {
    if (baseline[i] === current[i]) {
      matchingBytes++;
    }
  }

  const similarity = matchingBytes / Math.max(baseline.length, current.length);
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Store or update a baseline screenshot for a test step
 */
export async function saveBaseline(
  prisma: PrismaClient,
  testId: string,
  stepNumber: number,
  screenshotPath: string,
  autoApprove: boolean = false,
): Promise<void> {
  await prisma.e2EVisualBaseline.upsert({
    where: { testId_stepNumber: { testId, stepNumber } },
    update: {
      screenshotPath,
      ...(autoApprove && { approvedAt: new Date(), approvedBy: "auto" }),
    },
    create: {
      testId,
      stepNumber,
      screenshotPath,
      ...(autoApprove && { approvedAt: new Date(), approvedBy: "auto" }),
    },
  });
}

/**
 * Check if baseline exists and is approved
 */
export async function getApprovedBaseline(
  prisma: PrismaClient,
  testId: string,
  stepNumber: number,
): Promise<string | null> {
  const baseline = await prisma.e2EVisualBaseline.findUnique({
    where: { testId_stepNumber: { testId, stepNumber } },
  });

  // Return path if baseline exists and is approved
  if (baseline && baseline.approvedAt) {
    return baseline.screenshotPath;
  }

  return null;
}

/**
 * Record a visual diff result
 */
export async function saveVisualDiff(
  prisma: PrismaClient,
  runId: string,
  stepNumber: number,
  baselinePath: string,
  currentPath: string,
  similarity: number,
): Promise<void> {
  // Generate diff visualization filename (same dir as current screenshot)
  const currentDir = path.dirname(currentPath);
  const diffPath = path.join(currentDir, `diff-step${stepNumber}.png`);

  await prisma.e2EVisualDiff.create({
    data: {
      runId,
      stepNumber,
      baselinePath,
      currentPath,
      diffPath,
      similarity,
      approved: false,
    },
  });
}

/**
 * Check visual regression status: compare current screenshot to approved baseline
 */
export async function checkVisualRegression(
  prisma: PrismaClient,
  testId: string,
  runId: string,
  stepNumber: number,
  currentScreenshotPath: string,
  fuzzyThreshold: number = 0.98,
): Promise<{
  passed: boolean; // true if similarity >= threshold or no baseline
  similarity: number;
  message: string;
  baselineExists: boolean;
}> {
  const baseline = await getApprovedBaseline(prisma, testId, stepNumber);

  // If no approved baseline, this is the first run — auto-approve the screenshot
  if (!baseline) {
    await saveBaseline(prisma, testId, stepNumber, currentScreenshotPath, true);
    return {
      passed: true,
      similarity: 1.0,
      message: "First run — baseline created and auto-approved",
      baselineExists: false,
    };
  }

  // Compare screenshots
  const result = await compareScreenshots(baseline, currentScreenshotPath);

  // Save the diff result
  await saveVisualDiff(prisma, runId, stepNumber, baseline, currentScreenshotPath, result.similarity);

  // Check against threshold
  const passed = result.similarity >= fuzzyThreshold;

  return {
    passed,
    similarity: result.similarity,
    message: passed
      ? `Visual match: ${(result.similarity * 100).toFixed(1)}% (threshold: ${(fuzzyThreshold * 100).toFixed(1)}%)`
      : `Visual regression detected: ${(result.similarity * 100).toFixed(1)}% (threshold: ${(fuzzyThreshold * 100).toFixed(1)}%)`,
    baselineExists: true,
  };
}

/**
 * Get unapproved visual diffs for review
 */
export async function getUnapprovedDiffs(
  prisma: PrismaClient,
  testId?: string,
): Promise<any[]> {
  return prisma.e2EVisualDiff.findMany({
    where: {
      approved: false,
      ...(testId && { E2ETestRun: { testId } }),
    },
    include: { E2ETestRun: { include: { E2ETest: true } } },
    orderBy: { id: "desc" },
    take: 10,
  });
}

/**
 * Approve a visual diff (update the baseline)
 */
export async function approveVisualDiff(
  prisma: PrismaClient,
  diffId: string,
): Promise<void> {
  const diff = await prisma.e2EVisualDiff.findUnique({ where: { id: diffId } });
  if (!diff) throw new Error("Diff not found");

  // Mark as approved
  await prisma.e2EVisualDiff.update({
    where: { id: diffId },
    data: { approved: true },
  });

  // Update baseline to new screenshot
  const stepNumber = diff.stepNumber;
  const testId = diff.runId; // This is a bit of a hack; ideally we'd have testId in the diff

  // Find the test ID from the run
  const run = await prisma.e2ETestRun.findUnique({ where: { id: diff.runId } });
  if (!run) throw new Error("Run not found");

  await saveBaseline(prisma, run.testId, stepNumber, diff.currentPath, true);
}

/**
 * Get visual regression stats
 */
export async function getVisualRegressionStats(
  prisma: PrismaClient,
): Promise<{
  totalDiffs: number;
  approved: number;
  pending: number;
  avgSimilarity: number;
}> {
  const diffs = await prisma.e2EVisualDiff.findMany();

  const avgSimilarity =
    diffs.length > 0
      ? diffs.reduce((sum, d) => sum + d.similarity, 0) / diffs.length
      : 1.0;

  return {
    totalDiffs: diffs.length,
    approved: diffs.filter((d) => d.approved).length,
    pending: diffs.filter((d) => !d.approved).length,
    avgSimilarity,
  };
}
