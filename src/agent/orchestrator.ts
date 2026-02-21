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
import { runChat } from "./chat.js";

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
          const chatResult = await runChat(
            command.instruction,
            this.config,
            siteKnowledge,
            learnings,
            getCurrentUrl(),
          );
          result = {
            message: chatResult.reply,
            usage: {
              input_tokens: chatResult.inputTokens,
              output_tokens: chatResult.outputTokens,
            },
            success: true,
          };
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

    const isStreamed = command.mode === "chat" ||
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
    const lower = instruction.toLowerCase();

    if (lower.startsWith("go to ") || lower.startsWith("navigate to ") || lower.startsWith("open ")) {
      const urlMatch = instruction.match(/https?:\/\/\S+/);
      if (urlMatch) {
        return runGoto(this.stagehand, urlMatch[0]);
      }
    }

    // Route conversational/question messages to chat (fast, uses knowledge)
    const isConversational =
      /^(hey|hi|hello|yo|thanks|thank you|ok|sure|cool|nice|good|great|awesome)\b/i.test(lower) ||
      /^(what|how|why|who|where|when|which|is |are |do |does |can |could |would |should |tell me|explain|describe)/i.test(lower) ||
      lower.endsWith("?");

    if (isConversational) {
      const chatResult = await runChat(
        instruction,
        this.config,
        siteKnowledge,
        learnings,
        getCurrentUrl(),
      );
      return {
        message: chatResult.reply,
        usage: {
          input_tokens: chatResult.inputTokens,
          output_tokens: chatResult.outputTokens,
        },
        success: true,
        streamed: true,
      };
    }

    if (lower.includes("test ") || lower.includes("verify ") || lower.includes("check ") || lower.length > 100) {
      return runTask(
        this.stagehand,
        instruction,
        this.config,
        siteKnowledge,
        learnings,
      );
    }

    return runAct(this.stagehand, instruction);
  }
}
