import fs from "fs/promises";
import path from "path";
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

interface BillingLedger {
  cycleStart: string;
  cycleDayOfMonth: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  sessionCount: number;
  lastUpdated: string;
}

export class CostTracker {
  private sessionTotalInput = 0;
  private sessionTotalOutput = 0;
  private sessionTotalCost = 0;
  private pendingInput = 0;
  private pendingOutput = 0;
  private model: string;
  private ledger: BillingLedger | null = null;
  private ledgerPath: string;

  constructor(model: string, dataDir = "./data") {
    this.model = model;
    this.ledgerPath = path.join(dataDir, "billing.json");
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

  record(usage: UsageData | undefined): CostSnapshot {
    if (usage) {
      this.pendingInput += usage.input_tokens;
      this.pendingOutput += usage.output_tokens;
    }
    return this.flush();
  }

  flush(): CostSnapshot {
    const inputTokens = this.pendingInput;
    const outputTokens = this.pendingOutput;

    const pricing = getPricing(this.model);
    const costUsd =
      (inputTokens / 1_000_000) * pricing.inputPerMillionTokens +
      (outputTokens / 1_000_000) * pricing.outputPerMillionTokens;

    this.sessionTotalInput += inputTokens;
    this.sessionTotalOutput += outputTokens;
    this.sessionTotalCost += costUsd;

    if (this.ledger) {
      this.ledger.totalInputTokens += inputTokens;
      this.ledger.totalOutputTokens += outputTokens;
      this.ledger.totalCostUsd += costUsd;
      this.ledger.lastUpdated = new Date().toISOString();
      this.saveLedger().catch(() => {});
    }

    this.pendingInput = 0;
    this.pendingOutput = 0;

    return { inputTokens, outputTokens, costUsd };
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
      cycleStart: this.ledger.cycleStart,
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

  private async loadLedger(): Promise<BillingLedger> {
    try {
      const raw = await fs.readFile(this.ledgerPath, "utf-8");
      const data = JSON.parse(raw) as Partial<BillingLedger>;
      return {
        cycleStart: data.cycleStart ?? new Date().toISOString(),
        cycleDayOfMonth: data.cycleDayOfMonth ?? 1,
        totalCostUsd: data.totalCostUsd ?? 0,
        totalInputTokens: data.totalInputTokens ?? 0,
        totalOutputTokens: data.totalOutputTokens ?? 0,
        sessionCount: data.sessionCount ?? 0,
        lastUpdated: data.lastUpdated ?? new Date().toISOString(),
      };
    } catch {
      return {
        cycleStart: new Date().toISOString(),
        cycleDayOfMonth: 1,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        sessionCount: 0,
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  private maybeResetCycle(): void {
    if (!this.ledger) return;
    const now = new Date();
    const cycleStart = new Date(this.ledger.cycleStart);
    const resetDay = this.ledger.cycleDayOfMonth;

    let nextReset = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), resetDay);
    if (nextReset <= cycleStart) {
      nextReset.setMonth(nextReset.getMonth() + 1);
    }

    if (now >= nextReset) {
      this.ledger.cycleStart = now.toISOString();
      this.ledger.totalCostUsd = 0;
      this.ledger.totalInputTokens = 0;
      this.ledger.totalOutputTokens = 0;
      this.ledger.sessionCount = 0;
    }
  }

  private async saveLedger(): Promise<void> {
    if (!this.ledger) return;
    await fs.writeFile(this.ledgerPath, JSON.stringify(this.ledger, null, 2));
  }
}
