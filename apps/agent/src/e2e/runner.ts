import { Stagehand } from "@browserbasehq/stagehand";
import { PrismaClient } from "@prisma/client";
import { AppConfig } from "../config/types.js";
import { MemoryManager } from "../memory/manager.js";
import { CostTracker, UsageData } from "../cost/tracker.js";
import { tagE2ELearnings, getDomainLearnings, formatLearningsContext } from "./learnings.js";
import { checkVisualRegression } from "./visual.js";
import { executeSmartStep } from "./step-executor.js";
import { BrowserPool } from "../browser/pool.js";
import type { OutputSink } from "../output-sink.js";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

// For ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface E2EStepResult {
  stepNumber: number;
  instruction: string;
  status: "passed" | "failed" | "skipped";
  result?: string;
  error?: string;
  retryReasons?: string[]; // Track why each retry happened
  durationMs: number;
  screenshot?: string; // After screenshot
  screenshotBefore?: string; // Before screenshot
  retryCount: number;
}

export interface E2ERunResult {
  testId: string;
  runId: string;
  status: "passed" | "failed" | "aborted";
  steps: E2EStepResult[];
  durationMs: number;
  totalUsage: UsageData;
  costUsd: number;
  passedRetry?: number;
  abortMessage?: string;
}

/**
 * Execute a test run: interpret natural language steps and drive the browser.
 */
export async function executeE2ETest(
  testDefinition: any, // JSON definition with steps array
  stagehand: Stagehand,
  config: AppConfig,
  memory: MemoryManager,
  costTracker: CostTracker,
  pool: BrowserPool,
  prisma: PrismaClient,
  runId: string,
  testId: string, // Add testId parameter for visual regression
  domain?: string, // Add domain parameter for homepage navigation
  sink?: OutputSink,
  signal?: AbortSignal,
): Promise<E2ERunResult> {
  const startTime = Date.now();
  const steps = testDefinition.steps || [];
  const results: E2EStepResult[] = [];
  let totalUsage: UsageData = { input_tokens: 0, output_tokens: 0 };
  let failedSteps = 0;
  let testAbortReason: string | undefined;
  
  // Ensure screenshots directory exists
  // process.cwd() returns the app root, which is /home/santo/DEV/world-tester/apps/agent (or /app/apps/agent in Docker)
  const screenshotsDir = path.join(process.cwd(), "..", "..", "data", "screenshots");
  console.log(`[E2E] Screenshots directory: ${screenshotsDir}`);
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // Fetch and log learnings for this domain
  let learningsContext = "";
  if (domain) {
    try {
      const domainLearnings = await getDomainLearnings(prisma, domain);
      learningsContext = formatLearningsContext(domainLearnings);
      if (learningsContext) {
        sink?.info(`[Learnings] Found ${domainLearnings.length} patterns for domain ${domain}`);
        sink?.info(learningsContext);
      }
    } catch (err) {
      sink?.warn(`Failed to fetch learnings: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // If domain is provided and first step isn't a navigation, navigate to domain first
  const firstStepIsNavigation = steps.length > 0 && 
    (steps[0].toLowerCase().includes("navigate") || 
     steps[0].toLowerCase().includes("go to") || 
     steps[0].toLowerCase().includes("visit"));
  
  if (domain && !firstStepIsNavigation) {
    // Add automatic navigation to domain as first step
    const domainUrl = domain.startsWith("http://") || domain.startsWith("https://") 
      ? domain 
      : `https://${domain}`;
    sink?.info(`[Initialization] Navigating to domain: ${domainUrl}`);
    try {
      const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
      if (page) {
        await page.goto(domainUrl, { waitUntil: "domcontentloaded" });
        sink?.info(`[Initialization] Successfully navigated to ${domainUrl}`);
      }
    } catch (err) {
      sink?.warn(`[Initialization] Failed to navigate to domain: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    if (signal?.aborted) {
      testAbortReason = "Test was aborted by signal";
      sink?.error(testAbortReason);
      break;
    }

    const stepNumber = i + 1;
    const stepInstruction = steps[i];
    const stepStart = Date.now();

    sink?.info(`[Step ${stepNumber}/${steps.length}] ${stepInstruction}`);

    let result: E2EStepResult = {
      stepNumber,
      instruction: stepInstruction,
      status: "passed",
      durationMs: 0,
      retryCount: 0,
      retryReasons: [],
    };

    // Try the step with retry logic
    let success = false;
    let lastError: string | undefined;

    // Capture "before" screenshot (always capture for display)
    let beforeScreenshotPath: string | undefined;
    try {
      const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
      if (page) {
        const screenshotFilename = `e2e-${runId}-step${stepNumber}-before.png`;
        beforeScreenshotPath = path.join(screenshotsDir, screenshotFilename);
        console.log(`[E2E] Saving before screenshot to: ${beforeScreenshotPath}`);
        await page.screenshot({ path: beforeScreenshotPath });
        result.screenshotBefore = `/screenshots/${screenshotFilename}`;
        sink?.info(`Before screenshot: /screenshots/${screenshotFilename}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sink?.warn(`Failed to capture before screenshot for step ${stepNumber}: ${errorMsg}`);
      console.error(`[E2E] Before screenshot save error for step ${stepNumber}:`, err);
    }

    for (let attempt = 0; attempt <= (testDefinition.retryCount || 2); attempt++) {
      if (signal?.aborted) {
        result.status = "skipped";
        break;
      }

      try {
        // Determine if this is an assertion/wait or action
        const isAssertion = stepInstruction.toLowerCase().startsWith("assert") || 
                           stepInstruction.toLowerCase().startsWith("verify") ||
                           stepInstruction.toLowerCase().startsWith("check") ||
                           stepInstruction.toLowerCase().startsWith("confirm") ||
                           stepInstruction.toLowerCase().startsWith("wait");
        
        // Check if this is a wait instruction
        const isWait = stepInstruction.toLowerCase().startsWith("wait");

        // Normalize instruction - aggressively remove quotes
        let normalizedInstruction = stepInstruction.trim();
        
        // Remove surrounding quotes entirely if present
        normalizedInstruction = normalizedInstruction.replace(/^["']|["']$/g, "");
        
        // Handle Navigate to 'URL' -> Navigate to URL
        normalizedInstruction = normalizedInstruction.replace(/navigate to ['"]([^'"]+)['"]/i, "navigate to $1");
        
        // Handle any other quoted content like "field name" -> field name
        normalizedInstruction = normalizedInstruction.replace(/['"]([^'"]+)['"]/g, "$1");
        
        sink?.info(`[Step ${stepNumber}] Normalized: "${normalizedInstruction}"`);

        // Special handling for navigation - use goto() directly
        const navMatch = normalizedInstruction.match(/^navigate to\s+(.+)$/i) || 
                         normalizedInstruction.match(/^go to\s+(.+)$/i) ||
                         normalizedInstruction.match(/^visit\s+(.+)$/i);
        
        if (navMatch) {
          let url = navMatch[1].trim();
          
          // Remove any remaining quotes around the URL
          url = url.replace(/^["']|["']$/g, "");
          
          // Check if this is referring to the application homepage/base URL
          const isHomepageReference = url.toLowerCase().includes("base url") ||
                                     url.toLowerCase().includes("homepage") ||
                                     url.toLowerCase().includes("home page") ||
                                     url.toLowerCase().includes("application");
          
          if (isHomepageReference && domain) {
            // Use the domain provided in test settings for homepage/base URL references
            url = domain.startsWith("http://") || domain.startsWith("https://") 
              ? domain 
              : `https://${domain}`;
            sink?.info(`[Step ${stepNumber}] Homepage reference detected, using domain: ${url}`);
          } else {
            // Extract just the URL from phrases like "the base URL https://..." or "base url https://..."
            // First try to match full URLs (http:// or https://)
            let urlMatch = url.match(/https?:\/\/[^\s'"]+/);
            if (urlMatch) {
              url = urlMatch[0];
            } else {
              // If no full URL found, try domain patterns (something.com)
              urlMatch = url.match(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s'"]*\b/);
              if (urlMatch) {
                url = urlMatch[0];
              }
            }
          }
          
          // Check if we actually found a URL-like string
          const hasValidUrl = url.includes("http://") || url.includes("https://") || 
                             (url.includes(".") && !url.includes(" "));
          
          if (hasValidUrl) {
            // We found a valid URL, use goto directly
            try {
              // Ensure URL has a protocol
              if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
              }
              
              const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
              await page.goto(url, { waitUntil: "domcontentloaded" });
              
              // Check if the page loaded with an error (e.g., "This site can't be reached")
              try {
                const pageContent = await page.evaluate(() => document.documentElement.outerHTML);
                const isErrorPage = pageContent.toLowerCase().includes("this site can't be reached") ||
                                    pageContent.toLowerCase().includes("unable to reach") ||
                                    pageContent.toLowerCase().includes("connection refused") ||
                                    pageContent.toLowerCase().includes("err_") ||
                                    pageContent.toLowerCase().includes("failed to load");
                
                if (isErrorPage) {
                  throw new Error(`Failed to load ${url}: The site appears to be unreachable or returned an error page. Check that the URL is correct and accessible.`);
                }
              } catch (checkErr) {
                // If we can't check page content, that's OK - just log it and continue
                if (!String(checkErr).includes("is not a function")) {
                  throw checkErr;
                }
                sink?.warn(`[Step ${stepNumber}] Could not verify page loaded successfully, but navigation completed`);
              }
              
              result.result = `Navigated to ${url}`;
              success = true;
              // Navigation doesn't cost tokens, skip cost tracking for goto
            } catch (navErr) {
              const errorMsg = navErr instanceof Error ? navErr.message : String(navErr);
              throw new Error(`Failed to navigate to ${url}: ${errorMsg}`);
            }
          } else {
            // No valid URL found - use smart routing for natural language navigation
            sink?.info(`[Step ${stepNumber}] No URL detected in instruction, using smart routing...`);
            const smartResult = await executeSmartStep(
              normalizedInstruction,
              stagehand,
              config,
              memory,
              costTracker,
              pool,
              domain,
              sink,
              signal,
            );
            if (smartResult.success) {
              result.result = smartResult.message || "Navigation completed";
              success = true;
              // Track token usage
              if (smartResult.usage) {
                costTracker.addTokens(smartResult.usage.input_tokens || 0, smartResult.usage.output_tokens || 0);
              }
            } else {
              throw new Error(
                `Navigation instruction could not be understood: "${normalizedInstruction}"\n` +
                `Error: ${smartResult.message || "Navigation failed"}\n` +
                `Tip: Use a direct URL like "Navigate to https://example.com" or "Go to example.com"`
              );
            }
          }
        } else if (isWait) {
          // Handle wait instructions with a simple page wait
          try {
            // For wait instructions, just wait for the page to be stable
            // Extract any timeout if specified (e.g., "Wait 5 seconds" or "Wait for 10 seconds")
            const timeoutMatch = normalizedInstruction.match(/(\d+)\s*(?:seconds?|ms|milliseconds?)/i);
            const waitTime = timeoutMatch ? parseInt(timeoutMatch[1]) * (normalizedInstruction.toLowerCase().includes("ms") ? 1 : 1000) : 5000;
            
            const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
            if (page) {
              // Wait for the page to be stable - use a combination of networkidle and timeout
              await page.waitForLoadState("networkidle").catch(() => {
                // Ignore timeout errors - just means page is considered loaded
              });
              
              // Additional wait for DOM stability
              await page.evaluate(() => {
                return new Promise((resolve) => {
                  let timeoutId: NodeJS.Timeout;
                  const observer = new MutationObserver(() => {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(resolve, 500); // Wait 500ms of no mutations
                  });
                  observer.observe(document, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                  });
                  timeoutId = setTimeout(resolve, Math.min(waitTime, 5000)); // Max wait
                });
              }).catch(() => {
                // Ignore errors from evaluation
              });
            }
            
            result.result = `Waited for page to stabilize`;
            success = true;
            // No token cost for waits
          } catch (waitErr) {
            // Don't fail on wait errors - just log them
            sink?.warn(`Wait instruction warning: ${waitErr instanceof Error ? waitErr.message : String(waitErr)}`);
            result.result = "Page wait completed (with warnings)";
            success = true;
          }
        } else if (isAssertion) {
          // Transform assertions into extraction queries for Stagehand
          // Stagehand's extract() needs to know what data to extract, not just what to assert
          let extractionPrompt = normalizedInstruction;
          
          // Convert assertion language to extraction language
          if (extractionPrompt.toLowerCase().startsWith("assert ")) {
            // "Assert X is Y" -> "Extract and verify: is X Y?"
            extractionPrompt = extractionPrompt.replace(/^assert\s+/i, "Extract and verify: ");
          } else if (extractionPrompt.toLowerCase().startsWith("verify ")) {
            // "Verify X" -> "Extract: X"
            extractionPrompt = extractionPrompt.replace(/^verify\s+/i, "Extract: ");
          } else if (extractionPrompt.toLowerCase().startsWith("check ")) {
            // "Check X" -> "Extract: X"
            extractionPrompt = extractionPrompt.replace(/^check\s+/i, "Extract: ");
          } else if (extractionPrompt.toLowerCase().startsWith("confirm ")) {
            // "Confirm X" -> "Extract: X"
            extractionPrompt = extractionPrompt.replace(/^confirm\s+/i, "Extract: ");
          }
          
          // Ensure the prompt is phrased as a question or extraction request
          if (!extractionPrompt.toLowerCase().includes("extract") && !extractionPrompt.endsWith("?")) {
            extractionPrompt = `Extract the following from the page: ${extractionPrompt}`;
          }
          
          sink?.info(`[Step ${stepNumber}] Converted assertion to extraction: "${extractionPrompt}"`);
          
          try {
            const extractResult = await stagehand.extract(extractionPrompt);
            const resultText = unwrapExtraction(extractResult);

            // Check if the result appears to be an error message (common patterns from Stagehand)
            const isErrorMessage = resultText.toLowerCase().includes("cannot") ||
                                   resultText.toLowerCase().includes("unable to") ||
                                   resultText.toLowerCase().includes("not found") ||
                                   resultText.toLowerCase().includes("could not") ||
                                   resultText.toLowerCase().includes("does not contain") ||
                                   resultText.toLowerCase().includes("failed to") ||
                                   resultText.toLowerCase().includes("no data") ||
                                   resultText.toLowerCase().includes("no information");

            // Simple pass if extract returned meaningful data (and it's not an error message)
            if (resultText && resultText.length > 0 && !isErrorMessage) {
              result.result = resultText;
              success = true;
              // Estimate cost for extract() call: ~300 input tokens, ~150 output tokens
              costTracker.addTokens(300, 150);
            } else {
              // If extraction returned empty or an error message, try using smart routing instead for boolean checks
              if (isErrorMessage) {
                sink?.info(`[Step ${stepNumber}] Extraction returned error: "${resultText}"`);
              } else {
                sink?.info(`[Step ${stepNumber}] Extraction returned no data, trying with smart routing...`);
              }
              const smartResult = await executeSmartStep(
                normalizedInstruction,
                stagehand,
                config,
                memory,
                costTracker,
                pool,
                domain,
                sink,
                signal,
              );
              if (smartResult.success) {
                result.result = smartResult.message || "Assertion verified";
                success = true;
                if (smartResult.usage) {
                  costTracker.addTokens(smartResult.usage.input_tokens || 0, smartResult.usage.output_tokens || 0);
                }
              } else {
                throw new Error(smartResult.message || "Assertion could not be verified");
              }
            }
          } catch (assertError) {
            const errMsg = assertError instanceof Error ? assertError.message : String(assertError);
            throw new Error(
              `Assertion could not be verified: "${normalizedInstruction}". ` +
              `Error: ${errMsg}. ` +
              `Make sure the assertion is specific and the element/state exists on the page.`
            );
          }
        } else {
          // Use smart routing for actions - gives access to AI reasoning and learnings
          try {
            const smartResult = await executeSmartStep(
              normalizedInstruction,
              stagehand,
              config,
              memory,
              costTracker,
              pool,
              domain,
              sink,
              signal,
            );
            
            if (smartResult.success) {
              result.result = smartResult.message || "Action completed";
              success = true;
              // Track token usage from smart execution
              if (smartResult.usage) {
                costTracker.addTokens(smartResult.usage.input_tokens || 0, smartResult.usage.output_tokens || 0);
              }
              // Show thinking if available
              if (smartResult.thinking) {
                sink?.info(`[Step ${stepNumber}] Thinking:\n${smartResult.thinking}`);
              }
            } else {
              throw new Error(smartResult.message || "Action failed");
            }
          } catch (actError) {
            const errMsg = actError instanceof Error ? actError.message : String(actError);
            // Provide better feedback for common issues
            if (errMsg.includes("No object generated")) {
              throw new Error(`AI couldn't understand the instruction. Try simpler language like "Click the search box" or "Type hello". Original: ${normalizedInstruction}`);
            }
            throw actError;
          }
        }

        break; // Success, exit retry loop
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        result.retryCount = attempt;

        if (attempt < (testDefinition.retryCount || 2)) {
          sink?.warn(`Step ${stepNumber} failed: ${lastError}. Retrying... (${attempt + 1}/${testDefinition.retryCount})`);
          result.retryReasons?.push(lastError);
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Brief wait before retry
        }
      }
    }

    if (!success) {
      result.status = "failed";
      result.error = lastError;
      failedSteps++;

      // Check strictness level — if high, stop on first failure
      const strictness = testDefinition.strictnessLevel || "medium";
      if (strictness === "high") {
        sink?.error(`Step ${stepNumber} failed (strictness=high). Aborting test.`);
        results.push(result);
        break;
      }
    } else {
      // Validate that successful steps have a result - don't allow null results
      if (!result.result || (typeof result.result === "string" && result.result.trim() === "")) {
        result.status = "failed";
        result.error = "Step completed but returned no result. This may indicate the action did not execute properly.";
        failedSteps++;
        sink?.error(`Step ${stepNumber} failed: No result returned`);
      } else {
        // Check if the result message indicates the AI explicitly reported failure or inability
        const resultMsg = typeof result.result === "string" ? result.result.toLowerCase() : "";
        const failureIndicators = [
          /cannot\s+(?:complete|do|perform|execute)/i,
          /unable\s+to\s+(?:complete|do|perform|execute|log in|login)/i,
          /i\s+(?:cannot|cannot|do not|don't)\s+(?:have|possess).*(?:credentials|password|username)/i,
          /(?:failed|fail)\s+to\s+(?:complete|do|perform|execute|log in|login)/i,
          /(?:do not|don't)\s+(?:have|possess)\s+(?:credentials|password|username)/i,
        ];
        
        const indicatesFailure = failureIndicators.some(pattern => pattern.test(resultMsg));
        
        if (indicatesFailure) {
          result.status = "failed";
          result.error = `AI reported inability to complete task: ${result.result}`;
          failedSteps++;
          sink?.error(`Step ${stepNumber} failed: ${result.error}`);
        } else {
          result.status = "passed";
        }
      }
    }

    result.durationMs = Date.now() - stepStart;
    results.push(result);

    // Take screenshot after each step (always capture for display) - BEFORE saving to DB
    try {
      const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
      if (page) {
        const screenshotFilename = `e2e-${runId}-step${stepNumber}.png`;
        const screenshotPath = path.join(screenshotsDir, screenshotFilename);
        console.log(`[E2E] Saving after screenshot to: ${screenshotPath}`);
        await page.screenshot({ path: screenshotPath });
        result.screenshot = `/screenshots/${screenshotFilename}`;
        sink?.info(`Screenshot: /screenshots/${screenshotFilename}`);

        // Check visual regression against baseline if enabled
        if (testDefinition.visualRegressionEnabled) {
          const visualRegression = await checkVisualRegression(
            prisma,
            testId,
            runId,
            stepNumber,
            screenshotPath,
            testDefinition.visualFuzzyThreshold || 0.98,
          );

          if (!visualRegression.passed && visualRegression.baselineExists) {
            sink?.warn(`Visual regression: ${visualRegression.message}`);
          } else if (visualRegression.message) {
            sink?.info(visualRegression.message);
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sink?.warn(`Failed to capture screenshot for step ${stepNumber}: ${errorMsg}`);
      console.error(`[E2E] Screenshot save error for step ${stepNumber}:`, err);
    }

    // Save step result immediately to database for live updates
    try {
      console.log(`[E2E] Saving step ${stepNumber} to database for run ${runId}:`, {
        stepNumber: result.stepNumber,
        status: result.status,
        screenshot: result.screenshot,
        screenshotBefore: result.screenshotBefore,
        hasResult: !!result.result,
      });
      await prisma.e2ETestStep.create({
        data: {
          runId: runId,
          stepNumber: result.stepNumber,
          instruction: result.instruction,
          status: result.status,
          result: result.result ? JSON.stringify({
            text: result.result,
            retryReasons: result.retryReasons,
          }) : undefined,
          screenshot: result.screenshot,
          screenshotBefore: result.screenshotBefore,
          durationMs: result.durationMs,
          errorMessage: result.error,
          retryCount: result.retryCount,
        },
      });
      sink?.info(`Step ${stepNumber} result saved to database`);
    } catch (dbErr) {
      sink?.warn(`Failed to save step ${stepNumber} to database: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
      console.error(`[E2E] Database error saving step ${stepNumber}:`, dbErr);
    }
  }

  const durationMs = Date.now() - startTime;
  const status = signal?.aborted ? "aborted" : failedSteps === 0 ? "passed" : "failed";

  // Flush any remaining pending tokens and get the total cost
  const costSnapshot = costTracker.record(undefined);

  // Determine if test was incomplete
  const isIncomplete = results.length < steps.length;
  let abortMessage = "";
  
  if (testAbortReason) {
    abortMessage = testAbortReason;
  } else if (isIncomplete && failedSteps === 0) {
    // Test stopped without a failure - something else caused it
    abortMessage = `Test execution stopped early after ${results.length} of ${steps.length} steps without explicit failure`;
    sink?.error(abortMessage);
  }

  return {
    testId,
    runId,
    status,
    steps: results,
    durationMs,
    totalUsage,
    costUsd: costSnapshot.costUsd,
    abortMessage,
  };
}

/**
 * Unwrap single-value objects from Stagehand extract()
 */
function unwrapExtraction(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const values = Object.values(result as Record<string, unknown>);
    if (values.length === 1 && typeof values[0] === "string") {
      return values[0];
    }
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Save test run to database and tag learnings
 */
export async function saveTestRun(
  prisma: PrismaClient,
  memory: MemoryManager,
  result: E2ERunResult,
  testName: string,
  domain: string,
): Promise<void> {
  // Determine error message from failed steps or abort message
  let errorMessage: string | undefined;
  
  if (result.abortMessage) {
    errorMessage = result.abortMessage;
  } else if (result.status === "failed") {
    // Get the first failed step's error message
    const failedStep = result.steps.find(s => s.status === "failed");
    if (failedStep && failedStep.error) {
      errorMessage = `Step ${failedStep.stepNumber}: ${failedStep.error}`;
    } else {
      errorMessage = "Test execution failed";
    }
  }

  // Update the test run record
  await prisma.e2ETestRun.update({
    where: { id: result.runId },
    data: {
      status: result.status === "aborted" ? "skipped" : result.status === "passed" ? "passed" : "failed",
      verdict: result.status,
      completedAt: new Date(),
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      errorMessage,
    },
  });

  // Note: Step results are now saved incrementally during test execution,
  // so we don't need to create them again here. This prevents duplicates.

  // Tag learnings from successful test runs
  if (result.status === "passed") {
    await tagE2ELearnings(prisma, memory, result.testId, testName, result, domain);
  }
}
