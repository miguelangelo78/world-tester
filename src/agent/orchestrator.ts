import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { CostTracker } from "../cost/tracker.js";
import { MemoryManager } from "../memory/manager.js";
import { ParsedCommand } from "../cli/parser.js";
import { getDomain, getCurrentUrl } from "../browser/stagehand.js";
import * as display from "../cli/display.js";
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

export class Orchestrator {
  private stagehand: Stagehand;
  private config: AppConfig;
  private costTracker: CostTracker;
  private memory: MemoryManager;

  constructor(
    stagehand: Stagehand,
    config: AppConfig,
    costTracker: CostTracker,
    memory: MemoryManager,
  ) {
    this.stagehand = stagehand;
    this.config = config;
    this.costTracker = costTracker;
    this.memory = memory;
  }

  async execute(command: ParsedCommand): Promise<void> {
    const startTime = Date.now();
    const domain = getDomain();

    display.info(`${display.modeLabel(command.mode)} ${command.instruction}`);

    const siteKnowledge = await this.memory.getSiteKnowledge(domain);
    const learnings = await this.memory.getLearnings(domain);

    let result: ModeResult;

    try {
      switch (command.mode) {
        case "extract":
          result = await runExtract(this.stagehand, command.instruction);
          break;
        case "act":
          result = await runAct(this.stagehand, command.instruction);
          break;
        case "observe":
          result = await runObserve(this.stagehand, command.instruction);
          break;
        case "task":
          result = await runTask(
            this.stagehand,
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
          );
          break;
        case "goto":
          result = await runGoto(this.stagehand, command.instruction);
          break;
        case "search":
          result = await runSearch(
            this.stagehand,
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
          );
          break;
        case "ask":
          result = await runAsk(
            this.stagehand,
            command.instruction,
            siteKnowledge,
            learnings,
          );
          break;
        case "chat": {
          result = await this.runSmartMode(
            command.instruction, siteKnowledge, learnings,
          );
          break;
        }
        case "learn":
          result = await runLearn(
            this.stagehand,
            this.config,
            this.memory,
            command.instruction,
          );
          break;
        case "auto":
          result = await this.runAuto(command.instruction, siteKnowledge, learnings);
          break;
        default:
          result = { message: `Unknown mode: ${command.mode}`, success: false };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      display.error(`Command failed: ${msg}`);
      this.memory.addSessionEntry({
        role: "agent",
        content: `Error: ${msg}`,
        mode: command.mode,
      });
      return;
    }

    const duration = Date.now() - startTime;
    const costSnapshot = this.costTracker.record(result.usage);

    const isStreamed =
      (command.mode === "chat" && result.streamed) ||
      (command.mode === "auto" && result.streamed);
    if (!isStreamed) {
      display.agentMessage(result.message);
    }
    display.cost(this.costTracker.formatCostLine(costSnapshot));
    display.info(`Completed in ${(duration / 1000).toFixed(1)}s`);
    display.separator();

    // Log to session
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

    // Keep chat history in sync for non-chat modes so the agent remembers
    // everything that happened when the user switches to chat later
    if (!["chat", "auto"].includes(command.mode)) {
      const modeTag = `[${command.mode}]`;
      addToHistory("user", `${modeTag} ${command.instruction}`);
      addToHistory("model", `${modeTag} ${result.message.slice(0, 300)}`);
    }

    // Save task record for task mode
    const taskId = Date.now().toString(36);
    if (command.mode === "task") {
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

    // Self-training runs in background so the prompt returns immediately
    if (!["goto", "learn", "chat"].includes(command.mode)) {
      extractPostCommandLearnings(
        this.stagehand,
        this.memory,
        domain,
        command.instruction,
        command.mode,
        result,
        taskId,
      ).catch(() => {});
    }
  }

  private async runAuto(
    instruction: string,
    siteKnowledge: Awaited<ReturnType<MemoryManager["getSiteKnowledge"]>>,
    learnings: Awaited<ReturnType<MemoryManager["getLearnings"]>>,
  ): Promise<ModeResult> {
    // Direct URL navigation bypass
    const urlMatch = instruction.match(/^https?:\/\/\S+$/);
    if (urlMatch) {
      return runGoto(this.stagehand, urlMatch[0]);
    }

    return this.runSmartMode(instruction, siteKnowledge, learnings);
  }

  /**
   * Shared smart routing: intent classification via chat agent, with handoff to
   * browser modes when needed. Used by both `c:` (chat) and auto (no prefix).
   */
  private async runSmartMode(
    instruction: string,
    siteKnowledge: Awaited<ReturnType<MemoryManager["getSiteKnowledge"]>>,
    learnings: Awaited<ReturnType<MemoryManager["getLearnings"]>>,
  ): Promise<ModeResult> {
    const chatResult = await runSmartChat(
      instruction,
      this.config,
      siteKnowledge,
      learnings,
      getCurrentUrl(),
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

    // Hand off to browser mode
    const handoffInstruction = chatResult.instruction ?? instruction;
    display.modeSwitch("chat", chatResult.action, handoffInstruction);

    let browserResult: ModeResult;

    switch (chatResult.action) {
      case "task":
        browserResult = await runTask(
          this.stagehand,
          handoffInstruction,
          this.config,
          siteKnowledge,
          learnings,
        );
        break;
      case "act":
        browserResult = await runAct(this.stagehand, handoffInstruction);
        break;
      case "goto":
        browserResult = await runGoto(this.stagehand, handoffInstruction);
        break;
      case "learn":
        browserResult = await runLearn(
          this.stagehand,
          this.config,
          this.memory,
          handoffInstruction,
        );
        break;
      case "extract":
        browserResult = await runExtract(this.stagehand, handoffInstruction);
        break;
      default:
        browserResult = await runAct(this.stagehand, handoffInstruction);
    }

    // Inject browser result into chat history, then stream a chat follow-up
    const status = browserResult.success ? "completed" : "failed";
    const resultSummary = browserResult.message.slice(0, 500);
    addToHistory("model", `[${chatResult.action} ${status}] ${resultSummary}`);

    const siteKnowledgeNow = await this.memory.getSiteKnowledge(getDomain());
    const learningsNow = await this.memory.getLearnings(getDomain());

    const followUp = await runChat(
      `[System: you just executed a ${chatResult.action} action for the user. ` +
      `The instruction was: "${handoffInstruction}". ` +
      `Result (${status}): ${resultSummary}. ` +
      `Give a brief, friendly summary of what happened and ask if they need anything else.]`,
      this.config,
      siteKnowledgeNow,
      learningsNow,
      getCurrentUrl(),
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
}
