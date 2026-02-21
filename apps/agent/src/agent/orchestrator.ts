import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { CostTracker } from "../cost/tracker.js";
import { MemoryManager } from "../memory/manager.js";
import { ParsedCommand } from "../cli/parser.js";
import { BrowserPool } from "../browser/pool.js";
import type { OutputSink } from "../output-sink.js";
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
import { runTest } from "./test-runner.js";

export class Orchestrator {
  private pool: BrowserPool;
  private config: AppConfig;
  private costTracker: CostTracker;
  private memory: MemoryManager;

  constructor(
    pool: BrowserPool,
    config: AppConfig,
    costTracker: CostTracker,
    memory: MemoryManager,
  ) {
    this.pool = pool;
    this.config = config;
    this.costTracker = costTracker;
    this.memory = memory;
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

  async execute(command: ParsedCommand, sink: OutputSink): Promise<void> {
    const startTime = Date.now();
    const target = this.resolveTarget(command);
    const stagehand = target.stagehand;
    const domain = target.getDomain();

    await target.focusActiveTab();
    target.setSink(sink);

    if (command.targetBrowser) {
      const tabLabel = command.targetTab !== undefined ? `:${command.targetTab}` : "";
      sink.info(`[→ ${command.targetBrowser}${tabLabel}] [${command.mode}] ${command.instruction}`);
    } else {
      sink.info(`[${command.mode}] ${command.instruction}`);
    }

    const siteKnowledge = await this.memory.getSiteKnowledge(domain);
    const learnings = await this.memory.getLearnings(domain);

    let result: ModeResult;

    try {
      switch (command.mode) {
        case "extract":
          result = await runExtract(stagehand, command.instruction);
          break;
        case "act":
          result = await runAct(stagehand, command.instruction);
          break;
        case "observe":
          result = await runObserve(stagehand, command.instruction);
          break;
        case "task":
          result = await runTask(
            stagehand,
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
            sink,
          );
          break;
        case "goto":
          result = await runGoto(stagehand, command.instruction);
          break;
        case "search":
          result = await runSearch(
            stagehand,
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
          );
          break;
        case "ask":
          result = await runAsk(
            stagehand,
            command.instruction,
            siteKnowledge,
            learnings,
          );
          break;
        case "chat": {
          result = await this.runSmartMode(
            command.instruction, siteKnowledge, learnings, stagehand, sink,
          );
          break;
        }
        case "learn":
          result = await runLearn(
            stagehand,
            this.config,
            this.memory,
            command.instruction,
            sink,
          );
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
          );
          break;
        case "auto":
          result = await this.runAuto(command.instruction, siteKnowledge, learnings, stagehand, sink);
          break;
        default:
          result = { message: `Unknown mode: ${command.mode}`, success: false };
      }
    } catch (err) {
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

    const suppressMessage =
      command.mode === "test" ||
      ((command.mode === "chat" || command.mode === "auto") && result.streamed);
    if (!suppressMessage) {
      sink.agentMessage(result.message);
    }
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
  ): Promise<ModeResult> {
    const urlMatch = instruction.match(/^https?:\/\/\S+$/);
    if (urlMatch) {
      return runGoto(stagehand, urlMatch[0]);
    }

    return this.runSmartMode(instruction, siteKnowledge, learnings, stagehand, sink);
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
  ): Promise<ModeResult> {
    const currentUrl = this.resolveUrlFromStagehand(stagehand);

    const chatResult = await runSmartChat(
      instruction,
      this.config,
      siteKnowledge,
      learnings,
      currentUrl,
      this.pool,
      sink,
    );

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
        );
        break;
      case "act":
        browserResult = await runAct(stagehand, handoffInstruction);
        break;
      case "goto":
        browserResult = await runGoto(stagehand, handoffInstruction);
        break;
      case "learn":
        browserResult = await runLearn(
          stagehand,
          this.config,
          this.memory,
          handoffInstruction,
          sink,
        );
        break;
      case "extract":
        browserResult = await runExtract(stagehand, handoffInstruction);
        break;
      default:
        browserResult = await runAct(stagehand, handoffInstruction);
    }

    const status = browserResult.success ? "completed" : "failed";
    const resultSummary = browserResult.message.slice(0, 500);
    addToHistory("model", `[${chatResult.action} ${status}] ${resultSummary}`);

    const domainNow = this.resolveDomainFromStagehand(stagehand);
    const siteKnowledgeNow = await this.memory.getSiteKnowledge(domainNow);
    const learningsNow = await this.memory.getLearnings(domainNow);
    const urlNow = this.resolveUrlFromStagehand(stagehand);

    const followUp = await runChat(
      `[System: you just executed a ${chatResult.action} action for the user. ` +
      `The instruction was: "${handoffInstruction}". ` +
      `Result (${status}): ${resultSummary}. ` +
      `Give a brief, friendly summary of what happened and ask if they need anything else.]`,
      this.config,
      siteKnowledgeNow,
      learningsNow,
      urlNow,
      sink,
    );

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
      const page = (stagehand.context as any).activePage?.() ?? stagehand.context.pages()[0];
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
