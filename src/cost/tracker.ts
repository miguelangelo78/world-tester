import prisma from "../db.js";
import { getPricing } from "./pricing.js";

export interface UsageData {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  inference_time_ms?: number;
}

export interface CostSnapshot {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface LedgerState {
  cycleStart: Date;
  cycleDayOfMonth: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
}

export class CostTracker {
  private sessionTotalInput = 0;
  private sessionTotalOutput = 0;
  private sessionTotalCost = 0;
  private pendingInput = 0;
  private pendingOutput = 0;
  private model: string;
  private ledger: LedgerState | null = null;

  constructor(model: string, _dataDir = "./data") {
    this.model = model;
  }

  async init(): Promise<void> {
    this.ledger = await this.loadLedger();
    this.maybeResetCycle();
    this.ledger.sessionCount += 1;
    await this.saveLedger();
  }

  addTokens(inputTokens: number, outputTokens: number): void {
    this.pendingInput += inputTokens;
    this.pendingOutput += outputTokens;
  }

  /**
   * Records usage and flushes all pending tokens.  When `model` is provided,
   * the explicit `usage` tokens are priced at that model's rate while any
   * previously accumulated tokens (from `addTokens`) use the default CUA rate.
   */
  record(usage: UsageData | undefined, model?: string): CostSnapshot {
    // Price any tokens already queued via addTokens() at the default (CUA) rate
    const preInput = this.pendingInput;
    const preOutput = this.pendingOutput;
    const defaultPricing = getPricing(this.model);
    let costUsd =
      (preInput / 1_000_000) * defaultPricing.inputPerMillionTokens +
      (preOutput / 1_000_000) * defaultPricing.outputPerMillionTokens;
    let totalInput = preInput;
    let totalOutput = preOutput;

    // Price the explicit usage at the specified model rate (or default)
    if (usage) {
      const usagePricing = getPricing(model ?? this.model);
      costUsd +=
        (usage.input_tokens / 1_000_000) * usagePricing.inputPerMillionTokens +
        (usage.output_tokens / 1_000_000) * usagePricing.outputPerMillionTokens;
      totalInput += usage.input_tokens;
      totalOutput += usage.output_tokens;
    }

    this.sessionTotalInput += totalInput;
    this.sessionTotalOutput += totalOutput;
    this.sessionTotalCost += costUsd;

    if (this.ledger) {
      this.ledger.totalInputTokens += totalInput;
      this.ledger.totalOutputTokens += totalOutput;
      this.ledger.totalCostUsd += costUsd;
      this.saveLedger().catch(() => {});
    }

    this.pendingInput = 0;
    this.pendingOutput = 0;

    return { inputTokens: totalInput, outputTokens: totalOutput, costUsd };
  }

  flush(): CostSnapshot {
    return this.record(undefined);
  }

  getSessionTotal() {
    return {
      inputTokens: this.sessionTotalInput,
      outputTokens: this.sessionTotalOutput,
      costUsd: this.sessionTotalCost,
    };
  }

  getBillingCycleTotal() {
    if (!this.ledger) {
      return { costUsd: 0, inputTokens: 0, outputTokens: 0, cycleStart: "", sessionCount: 0 };
    }
    return {
      costUsd: this.ledger.totalCostUsd,
      inputTokens: this.ledger.totalInputTokens,
      outputTokens: this.ledger.totalOutputTokens,
      cycleStart: this.ledger.cycleStart.toISOString(),
      sessionCount: this.ledger.sessionCount,
    };
  }

  formatCostLine(lastAction: CostSnapshot): string {
    const session = this.getSessionTotal();
    const billing = this.getBillingCycleTotal();
    const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
    const fmtTokens = (n: number) => n.toLocaleString();

    return (
      `[Cost] Action: ${fmtUsd(lastAction.costUsd)} | ` +
      `Session: ${fmtUsd(session.costUsd)} | ` +
      `Billing cycle: ${fmtUsd(billing.costUsd)} | ` +
      `Tokens: ${fmtTokens(lastAction.inputTokens)} in / ${fmtTokens(lastAction.outputTokens)} out`
    );
  }

  private async loadLedger(): Promise<LedgerState> {
    const row = await prisma.billingLedger.findUnique({
      where: { id: "singleton" },
    });
    if (row) {
      return {
        cycleStart: row.cycleStart,
        cycleDayOfMonth: row.cycleDayOfMonth,
        totalCostUsd: row.totalCostUsd,
        totalInputTokens: row.totalInputTokens,
        totalOutputTokens: row.totalOutputTokens,
        sessionCount: row.sessionCount,
      };
    }
    return {
      cycleStart: new Date(),
      cycleDayOfMonth: 1,
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      sessionCount: 0,
    };
  }

  private maybeResetCycle(): void {
    if (!this.ledger) return;
    const now = new Date();
    const cycleStart = this.ledger.cycleStart;
    const resetDay = this.ledger.cycleDayOfMonth;

    const nextReset = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), resetDay);
    if (nextReset <= cycleStart) {
      nextReset.setMonth(nextReset.getMonth() + 1);
    }

    if (now >= nextReset) {
      this.ledger.cycleStart = now;
      this.ledger.totalCostUsd = 0;
      this.ledger.totalInputTokens = 0;
      this.ledger.totalOutputTokens = 0;
      this.ledger.sessionCount = 0;
    }
  }

  private async saveLedger(): Promise<void> {
    if (!this.ledger) return;
    await prisma.billingLedger.upsert({
      where: { id: "singleton" },
      update: {
        cycleStart: this.ledger.cycleStart,
        cycleDayOfMonth: this.ledger.cycleDayOfMonth,
        totalCostUsd: this.ledger.totalCostUsd,
        totalInputTokens: this.ledger.totalInputTokens,
        totalOutputTokens: this.ledger.totalOutputTokens,
        sessionCount: this.ledger.sessionCount,
      },
      create: {
        id: "singleton",
        cycleStart: this.ledger.cycleStart,
        cycleDayOfMonth: this.ledger.cycleDayOfMonth,
        totalCostUsd: this.ledger.totalCostUsd,
        totalInputTokens: this.ledger.totalInputTokens,
        totalOutputTokens: this.ledger.totalOutputTokens,
        sessionCount: this.ledger.sessionCount,
      },
    });
  }
}
