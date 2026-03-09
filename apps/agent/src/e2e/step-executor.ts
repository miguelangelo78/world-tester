/**
 * E2E Step Executor using Smart Routing
 * 
 * This module provides intelligent E2E step execution by leveraging the same
 * smart routing system used by the task command, giving steps access to:
 * - AI reasoning and classification
 * - Domain learnings and context
 * - Site knowledge
 * - Smart action classification (when to use browser automation vs chat)
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { MemoryManager } from "../memory/manager.js";
import { CostTracker, UsageData } from "../cost/tracker.js";
import { BrowserPool } from "../browser/pool.js";
import { runSmartChat } from "../agent/chat.js";
import { runAct, runGoto, runTask } from "../agent/modes.js";
import { OutputSink } from "../output-sink.js";
import { ChatAction } from "../agent/chat.js";

export interface SmartStepResult {
  success: boolean;
  message: string;
  action?: ChatAction;
  usage?: UsageData;
  durationMs: number;
  thinking?: string; // AI thinking process
}

/**
 * Execute an E2E step using smart routing (same as task command)
 * 
 * This function:
 * 1. Sends the instruction through the AI classifier
 * 2. If classified as an action, executes it with full context
 * 3. If classified as chat, returns the AI's response
 * 4. Has access to learnings, site knowledge, and domain context
 */
export async function executeSmartStep(
  instruction: string,
  stagehand: Stagehand,
  config: AppConfig,
  memory: MemoryManager,
  costTracker: CostTracker,
  pool: BrowserPool,
  domain?: string,
  sink?: OutputSink,
  signal?: AbortSignal,
): Promise<SmartStepResult> {
  const startTime = Date.now();

  try {
    // Get context from memory
    const domainToUse = domain || resolveDomainFromStagehand(stagehand);
    const siteKnowledge = await memory.getSiteKnowledge(domainToUse);
    const learnings = await memory.getLearnings(domainToUse);
    const currentUrl = resolveDomainFromStagehand(stagehand);

    // Classify the instruction using smart chat
    const chatResult = await runSmartChat(
      instruction,
      config,
      siteKnowledge,
      learnings,
      currentUrl,
      pool,
      sink,
    );

    const usage = {
      input_tokens: chatResult.inputTokens,
      output_tokens: chatResult.outputTokens,
    };

    // For E2E steps, we don't want chat responses - we want to execute the action
    // Even if classified as chat, convert it to a task execution
    // This ensures steps like "Login using your credentials" are actually executed, not answered
    const effectiveAction = chatResult.action === "chat" ? "task" : chatResult.action;
    const handoffInstruction = chatResult.action === "chat" ? instruction : (chatResult.instruction || instruction);

    // Handle browser pool actions
    if (effectiveAction === "spawn_browser") {
      const name = chatResult.instruction ?? `browser-${pool.size() + 1}`;
      const isolated = (chatResult as any).options?.isolated ?? false;
      try {
        sink?.info(`Spawning browser "${name}"...`);
        await pool.spawn(name, {
          profile: isolated ? "isolated" : "shared",
          startUrl: config.targetUrl,
        });
        sink?.success(`Browser "${name}" ready`);
        return {
          success: true,
          message: `Spawned new browser "${name}"`,
          action: "spawn_browser",
          usage,
          durationMs: Date.now() - startTime,
        };
      } catch (err) {
        return {
          success: false,
          message: `Failed to spawn browser: ${err instanceof Error ? err.message : String(err)}`,
          action: "spawn_browser",
          usage,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Handle browser actions (goto, act, click, etc.)
    // The instruction could be parsed to detect URLs
    const urlMatch = instruction.match(/^https?:\/\/\S+$/);
    if (urlMatch || effectiveAction === "goto") {
      const url = urlMatch?.[0] || chatResult.instruction;
      if (url) {
        try {
          const gotoResult = await runGoto(stagehand, url);
          return {
            success: gotoResult.success,
            message: gotoResult.message,
            action: "goto",
            usage,
            durationMs: Date.now() - startTime,
          };
        } catch (err) {
          return {
            success: false,
            message: `Failed to navigate: ${err instanceof Error ? err.message : String(err)}`,
            action: "goto",
            usage,
            durationMs: Date.now() - startTime,
          };
        }
      }
    }

    // For all other actions (click, type, login, submit, navigate, scroll, etc.)
    // Use runTask() which is the full CUA agent with verification, not just basic act()
    // This gives us much better accuracy for complex actions like "Login using credentials"
    try {
      const taskResult = await runTask(
        stagehand,
        handoffInstruction,
        config,
        siteKnowledge,
        learnings,
        sink,
        signal,
      );

      // Validate that the result has a message - don't accept null/empty results
      if (!taskResult.message || taskResult.message.trim() === "") {
        return {
          success: false,
          message: "Step completed but no result message was provided. The action may have failed or been unclear.",
          action: effectiveAction as ChatAction,
          usage: taskResult.usage || usage,
          durationMs: Date.now() - startTime,
          thinking: taskResult.thinking,
        };
      }

      return {
        success: taskResult.success,
        message: taskResult.message,
        action: effectiveAction as ChatAction,
        usage: taskResult.usage || usage,
        durationMs: Date.now() - startTime,
        thinking: taskResult.thinking,
      };
    } catch (err) {
      return {
        success: false,
        message: `Action failed: ${err instanceof Error ? err.message : String(err)}`,
        action: effectiveAction as ChatAction,
        usage,
        durationMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `Step execution error: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - startTime,
    };
  }
}

function resolveDomainFromStagehand(stagehand: Stagehand): string {
  try {
    const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
    if (page) {
      const url = page.url();
      const parsed = new URL(url);
      return parsed.hostname || "unknown";
    }
  } catch (err) {
    // Ignore errors
  }
  return "unknown";
}
