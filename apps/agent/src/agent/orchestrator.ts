import { Stagehand } from "@browserbasehq/stagehand";
import { PrismaClient } from "@prisma/client";
import { AppConfig } from "../config/types.js";
import { CostTracker } from "../cost/tracker.js";
import { MemoryManager } from "../memory/manager.js";
import { ParsedCommand } from "../cli/parser.js";
import { BrowserPool } from "../browser/pool.js";
import type { OutputSink } from "../output-sink.js";
import { raceAbort, throwIfAborted, isAbortError } from "../abort.js";
import {
  runExtract,
  runAct,
  runObserve,
  runTask,
  runGoto,
  runSearch,
  runAsk,
  ModeResult,
} from "./modes.js";
import { extractPostCommandLearnings, runLearn } from "./learning.js";
import { runSmartChat, runChat, addToHistory } from "./chat.js";
import { parseE2ETestFromConversation } from "./e2e-creator.js";
import { runTest } from "./test-runner.js";

export class Orchestrator {
  private pool: BrowserPool;
  private config: AppConfig;
  private costTracker: CostTracker;
  private memory: MemoryManager;
  private prisma: PrismaClient;

  constructor(
    pool: BrowserPool,
    config: AppConfig,
    costTracker: CostTracker,
    memory: MemoryManager,
    prisma: PrismaClient,
  ) {
    this.pool = pool;
    this.config = config;
    this.costTracker = costTracker;
    this.memory = memory;
    this.prisma = prisma;
  }

  /**
   * Resolve the target browser instance, switching its active tab if
   * the command includes a @browser:tab specifier.
   */
  private resolveTarget(command: ParsedCommand) {
    const browser = command.targetBrowser
      ? this.pool.get(command.targetBrowser)
      : this.pool.active();

    if (command.targetTab !== undefined) {
      browser.switchTab(command.targetTab);
    }

    return browser;
  }

  private resolveStagehand(command: ParsedCommand): Stagehand {
    return this.resolveTarget(command).stagehand;
  }

  private resolveDomain(command: ParsedCommand): string {
    return this.resolveTarget(command).getDomain();
  }

  private resolveUrl(command: ParsedCommand): string {
    return this.resolveTarget(command).getUrl();
  }

  async execute(command: ParsedCommand, sink: OutputSink, signal?: AbortSignal): Promise<void> {
    const startTime = Date.now();
    const target = this.resolveTarget(command);
    const stagehand = target.stagehand;
    const domain = target.getDomain();

    await target.focusActiveTab();
    target.setSink(sink);
    throwIfAborted(signal);

    if (command.targetBrowser) {
      const tabLabel = command.targetTab !== undefined ? `:${command.targetTab}` : "";
      sink.info(`[→ ${command.targetBrowser}${tabLabel}] [${command.mode}] ${command.instruction}`);
    } else {
      sink.info(`[${command.mode}] ${command.instruction}`);
    }

    const siteKnowledge = await this.memory.getSiteKnowledge(domain);
    const learnings = await this.memory.getLearnings(domain);
    throwIfAborted(signal);

    let result: ModeResult;

    try {
      switch (command.mode) {
        case "extract":
          result = await raceAbort(runExtract(stagehand, command.instruction), signal);
          break;
        case "act":
          result = await raceAbort(runAct(stagehand, command.instruction), signal);
          break;
        case "observe":
          result = await raceAbort(runObserve(stagehand, command.instruction), signal);
          break;
        case "task":
          result = await runTask(
            stagehand,
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
            sink,
            signal,
          );
          break;
        case "goto":
          result = await raceAbort(runGoto(stagehand, command.instruction), signal);
          break;
        case "search":
          result = await raceAbort(runSearch(
            stagehand,
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
          ), signal);
          break;
        case "ask":
          result = await raceAbort(runAsk(
            stagehand,
            command.instruction,
            siteKnowledge,
            learnings,
          ), signal);
          break;
        case "chat": {
          result = await this.runSmartMode(
            command.instruction, siteKnowledge, learnings, stagehand, sink, signal,
          );
          break;
        }
        case "learn":
          result = await raceAbort(runLearn(
            stagehand,
            this.config,
            this.memory,
            command.instruction,
            sink,
          ), signal);
          break;
        case "test":
          result = await runTest(
            stagehand,
            command.instruction,
            this.config,
            this.costTracker,
            this.memory,
            siteKnowledge,
            learnings,
            this.pool,
            sink,
            signal,
          );
          break;
        case "auto":
          result = await this.runAuto(command.instruction, siteKnowledge, learnings, stagehand, sink, signal);
          break;
        default:
          result = { message: `Unknown mode: ${command.mode}`, success: false };
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      sink.error(`Command failed: ${msg}`);
      this.memory.addSessionEntry({
        role: "agent",
        content: `Error: ${msg}`,
        mode: command.mode,
      });
      target.setSink(null);
      return;
    }

    const duration = Date.now() - startTime;

    const utilityModes = ["chat", "auto", "ask"];
    const resultModel = utilityModes.includes(command.mode)
      ? this.config.utilityModel
      : undefined;
    const costSnapshot = this.costTracker.record(result.usage, resultModel);

    // Broadcast the final message only for non-streamed responses
    // Streamed responses show content live via stream_chunk events, no need to broadcast again
    if (command.mode !== "test" && !result.streamed) {
      sink.agentMessage(result.message);
    }
    
    // Always persist the final message for conversation history
    this.memory.addConversationMessage({
      role: "agent",
      type: "agent",
      content: result.message,
      commandId: undefined,
    });
    sink.cost(this.costTracker.formatCostLine(costSnapshot));
    sink.info(`Completed in ${(duration / 1000).toFixed(1)}s`);
    sink.separator();

    this.memory.addSessionEntry({
      role: "user",
      content: command.raw,
      mode: command.mode,
    });
    this.memory.addSessionEntry({
      role: "agent",
      content: result.message,
      mode: command.mode,
      cost_usd: costSnapshot.costUsd,
    });

    if (!["chat", "auto"].includes(command.mode)) {
      const modeTag = `[${command.mode}]`;
      addToHistory("user", `${modeTag} ${command.instruction}`);
      addToHistory("model", `${modeTag} ${result.message.slice(0, 300)}`);
    }

    const taskId = Date.now().toString(36);
    if (command.mode === "task" || command.mode === "test") {
      await this.memory.saveTaskRecord({
        id: taskId,
        timestamp: new Date().toISOString(),
        command: command.raw,
        instruction: command.instruction,
        mode: command.mode,
        domain,
        steps: (result.actions ?? []).map((a) => JSON.stringify(a)),
        outcome: result.success ? "pass" : "fail",
        result: result.message,
        duration_ms: duration,
        cost_usd: costSnapshot.costUsd,
        tokens_in: costSnapshot.inputTokens,
        tokens_out: costSnapshot.outputTokens,
      });
    }

    await this.memory.saveSession();

    if (!["goto", "learn", "chat"].includes(command.mode)) {
      extractPostCommandLearnings(
        stagehand,
        this.memory,
        domain,
        command.instruction,
        command.mode,
        result,
        taskId,
      ).catch(() => {});
    }

    target.setSink(null);
  }

  private async runAuto(
    instruction: string,
    siteKnowledge: Awaited<ReturnType<MemoryManager["getSiteKnowledge"]>>,
    learnings: Awaited<ReturnType<MemoryManager["getLearnings"]>>,
    stagehand: Stagehand,
    sink: OutputSink,
    signal?: AbortSignal,
  ): Promise<ModeResult> {
    const urlMatch = instruction.match(/^https?:\/\/\S+$/);
    if (urlMatch) {
      return raceAbort(runGoto(stagehand, urlMatch[0]), signal);
    }

    return this.runSmartMode(instruction, siteKnowledge, learnings, stagehand, sink, signal);
  }

  /**
   * Shared smart routing: intent classification via chat agent, with handoff to
   * browser modes when needed. Now also handles spawn_browser / switch_browser
   * actions from the classifier.
   */
  private async runSmartMode(
    instruction: string,
    siteKnowledge: Awaited<ReturnType<MemoryManager["getSiteKnowledge"]>>,
    learnings: Awaited<ReturnType<MemoryManager["getLearnings"]>>,
    stagehand: Stagehand,
    sink: OutputSink,
    signal?: AbortSignal,
  ): Promise<ModeResult> {
    const currentUrl = this.resolveUrlFromStagehand(stagehand);

    const chatResult = await raceAbort(runSmartChat(
      instruction,
      this.config,
      siteKnowledge,
      learnings,
      currentUrl,
      this.pool,
      sink,
    ), signal);

    const classifyCost = {
      input_tokens: chatResult.inputTokens,
      output_tokens: chatResult.outputTokens,
    };

    if (chatResult.action === "chat") {
      return {
        message: chatResult.message ?? "",
        usage: classifyCost,
        success: true,
        streamed: true,
      };
    }

    // Handle browser pool actions from the classifier
    if (chatResult.action === "spawn_browser") {
      const name = chatResult.instruction ?? `browser-${this.pool.size() + 1}`;
      const isolated = (chatResult as any).options?.isolated ?? false;
      try {
        sink.info(`Spawning browser "${name}"...`);
        await this.pool.spawn(name, {
          profile: isolated ? "isolated" : "shared",
          startUrl: this.config.targetUrl,
        });
        sink.success(`Browser "${name}" ready`);
        return {
          message: `Spawned new browser "${name}"`,
          usage: classifyCost,
          success: true,
          streamed: false,
        };
      } catch (err) {
        return {
          message: `Failed to spawn browser: ${err instanceof Error ? err.message : String(err)}`,
          usage: classifyCost,
          success: false,
        };
      }
    }

    if (chatResult.action === "switch_browser") {
      const target = chatResult.instruction ?? "";
      try {
        this.pool.setActive(target);
        sink.success(`Switched to browser "${target}"`);
        return {
          message: `Switched to browser "${target}"`,
          usage: classifyCost,
          success: true,
          streamed: false,
        };
      } catch (err) {
        return {
          message: `Failed to switch browser: ${err instanceof Error ? err.message : String(err)}`,
          usage: classifyCost,
          success: false,
        };
      }
    }

    // Hand off to browser mode
    const handoffInstruction = chatResult.instruction ?? instruction;
    sink.modeSwitch("chat", chatResult.action, handoffInstruction);
    throwIfAborted(signal);

    let browserResult: ModeResult;

    switch (chatResult.action) {
      case "task":
        browserResult = await runTask(
          stagehand,
          handoffInstruction,
          this.config,
          siteKnowledge,
          learnings,
          sink,
          signal,
        );
        break;
      case "act":
        browserResult = await raceAbort(runAct(stagehand, handoffInstruction), signal);
        break;
      case "goto":
        browserResult = await raceAbort(runGoto(stagehand, handoffInstruction), signal);
        break;
      case "learn":
        browserResult = await raceAbort(runLearn(
          stagehand,
          this.config,
          this.memory,
          handoffInstruction,
          sink,
        ), signal);
        break;
      case "extract":
      case "observe":
        browserResult = await raceAbort(runExtract(stagehand, handoffInstruction), signal);
        break;
      case "create_e2e_test":
        try {
          const domain = (chatResult.options?.domain as string) || this.resolveDomainFromStagehand(stagehand);
          const e2eTest = await parseE2ETestFromConversation(
            { instruction: handoffInstruction, domain },
            this.config.generativeAiApiKey
          );
          
          // Create the test directly in the database without HTTP calls
          const normalizedSteps = e2eTest.steps.map(step => step.instruction);
          const testDefinition = {
            name: e2eTest.name,
            description: e2eTest.description,
            retryCount: e2eTest.retryCount,
            strictnessLevel: e2eTest.strictnessLevel,
            visualRegressionEnabled: e2eTest.visualRegressionEnabled,
            autoApproveBaseline: e2eTest.autoApproveBaseline,
            steps: normalizedSteps,
          };

          const created = await this.prisma.e2ETest.create({
            data: {
              name: e2eTest.name,
              description: e2eTest.description,
              domain: e2eTest.domain,
              definition: testDefinition as any,
              retryCount: e2eTest.retryCount,
              strictnessLevel: e2eTest.strictnessLevel,
              visualRegressionEnabled: e2eTest.visualRegressionEnabled,
              autoApproveBaseline: e2eTest.autoApproveBaseline,
            },
          });

          browserResult = {
            success: true,
            message: `✓ E2E test "${created.name}" created successfully with ${e2eTest.steps.length} steps for domain: ${e2eTest.domain}`,
          };
        } catch (err) {
          browserResult = {
            success: false,
            message: `Failed to create E2E test: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        break;
      default:
        browserResult = await raceAbort(runAct(stagehand, handoffInstruction), signal);
    }

    const status = browserResult.success ? "completed" : "failed";
    const resultSummary = browserResult.message.slice(0, 500);
    addToHistory("model", `[${chatResult.action} ${status}] ${resultSummary}`);

    // Persist learnings from the browser handoff (the main execute() skips this for chat mode)
    const handoffDomain = this.resolveDomainFromStagehand(stagehand);
    if (!["goto", "learn"].includes(chatResult.action)) {
      extractPostCommandLearnings(
        stagehand,
        this.memory,
        handoffDomain,
        handoffInstruction,
        chatResult.action,
        browserResult,
        `chat-handoff-${Date.now().toString(36)}`,
      ).catch(() => {});
    }

    const domainNow = this.resolveDomainFromStagehand(stagehand);
    const siteKnowledgeNow = await this.memory.getSiteKnowledge(domainNow);
    const learningsNow = await this.memory.getLearnings(domainNow);
    const urlNow = this.resolveUrlFromStagehand(stagehand);

    throwIfAborted(signal);

    // Log the system instruction for transparency (internal only, not shown to user)
    sink.info(`[System: you just executed a ${chatResult.action} action for the user. The instruction was: "${handoffInstruction}". Result (${status}): ${resultSummary}.`);

    const followUp = await raceAbort(runChat(
      `You just executed a ${chatResult.action} action. ` +
      `Result (${status}): ${resultSummary}. ` +
      `Give a brief, friendly summary of what happened and ask if they need anything else.`,
      this.config,
      siteKnowledgeNow,
      learningsNow,
      urlNow,
      sink,
    ), signal);

    return {
      message: followUp.message ?? resultSummary,
      usage: {
        input_tokens: classifyCost.input_tokens
          + (browserResult.usage?.input_tokens ?? 0)
          + followUp.inputTokens,
        output_tokens: classifyCost.output_tokens
          + (browserResult.usage?.output_tokens ?? 0)
          + followUp.outputTokens,
      },
      actions: browserResult.actions,
      success: browserResult.success,
      streamed: true,
    };
  }

  private resolveUrlFromStagehand(stagehand: Stagehand): string {
    try {
      // Prefer the pool's BrowserInstance which tracks the correct active tab
      const browser = this.pool.findByStagehand(stagehand);
      if (browser) return browser.getUrl();
      // Fallback to Stagehand's own page tracking
      const pages = stagehand.context?.pages?.();
      const page = (stagehand.context as any).activePage?.() ?? pages?.[0];
      return page?.url() ?? "about:blank";
    } catch {
      return "about:blank";
    }
  }

  private resolveDomainFromStagehand(stagehand: Stagehand): string {
    try {
      return new URL(this.resolveUrlFromStagehand(stagehand)).hostname;
    } catch {
      return "unknown";
    }
  }
}
