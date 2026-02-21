import prisma from "../db.js";
import {
  SiteKnowledge,
  TaskRecord,
  Learning,
  SessionEntry,
} from "./types.js";

export class MemoryManager {
  private sessionId: string;

  constructor(_dataDir: string) {
    this.sessionId = Date.now().toString(36);
  }

  async init(): Promise<void> {
    // Prisma handles table creation via `prisma db push`; nothing to do here.
  }

  // --- Site Knowledge ---

  async getSiteKnowledge(domain: string): Promise<SiteKnowledge | null> {
    const row = await prisma.siteKnowledge.findUnique({ where: { domain } });
    if (!row) return null;
    return {
      domain: row.domain,
      lastUpdated: row.lastUpdated.toISOString(),
      siteDescription: row.siteDescription ?? undefined,
      techStack: row.techStack,
      authMethod: row.authMethod ?? undefined,
      pages: (row.pages as unknown as SiteKnowledge["pages"]) ?? {},
      siteMap: row.siteMap,
      commonFlows: row.commonFlows,
      knownIssues: row.knownIssues,
      tips: row.tips,
    };
  }

  async saveSiteKnowledge(knowledge: SiteKnowledge): Promise<void> {
    await prisma.siteKnowledge.upsert({
      where: { domain: knowledge.domain },
      update: {
        siteDescription: knowledge.siteDescription ?? null,
        techStack: knowledge.techStack ?? [],
        authMethod: knowledge.authMethod ?? null,
        pages: knowledge.pages as object,
        siteMap: knowledge.siteMap,
        commonFlows: knowledge.commonFlows,
        knownIssues: knowledge.knownIssues,
        tips: knowledge.tips,
      },
      create: {
        domain: knowledge.domain,
        siteDescription: knowledge.siteDescription ?? null,
        techStack: knowledge.techStack ?? [],
        authMethod: knowledge.authMethod ?? null,
        pages: knowledge.pages as object,
        siteMap: knowledge.siteMap,
        commonFlows: knowledge.commonFlows,
        knownIssues: knowledge.knownIssues,
        tips: knowledge.tips,
      },
    });
  }

  // --- Task History ---

  async saveTaskRecord(record: TaskRecord): Promise<void> {
    await prisma.taskRecord.create({
      data: {
        id: record.id,
        timestamp: new Date(record.timestamp),
        command: record.command,
        instruction: record.instruction,
        mode: record.mode,
        domain: record.domain ?? null,
        steps: record.steps,
        outcome: record.outcome,
        result: record.result ?? null,
        durationMs: record.duration_ms,
        costUsd: record.cost_usd,
        tokensIn: record.tokens_in,
        tokensOut: record.tokens_out,
      },
    });
  }

  async getRecentTasks(limit = 10): Promise<TaskRecord[]> {
    const rows = await prisma.taskRecord.findMany({
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      command: r.command,
      instruction: r.instruction,
      mode: r.mode,
      domain: r.domain ?? undefined,
      steps: r.steps,
      outcome: r.outcome as TaskRecord["outcome"],
      result: r.result ?? undefined,
      duration_ms: r.durationMs,
      cost_usd: r.costUsd,
      tokens_in: r.tokensIn,
      tokens_out: r.tokensOut,
    }));
  }

  // --- Learnings ---

  async getLearnings(domain?: string): Promise<Learning[]> {
    const where = domain
      ? { OR: [{ domain }, { domain: "*" }] }
      : undefined;
    const rows = await prisma.learning.findMany({ where });
    return rows.map((r) => ({
      id: r.id,
      domain: r.domain,
      category: r.category as Learning["category"],
      pattern: r.pattern,
      confidence: r.confidence,
      source_task_id: r.sourceTaskId,
      created: r.created.toISOString(),
    }));
  }

  async addLearning(learning: Omit<Learning, "id" | "created">): Promise<void> {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      await prisma.learning.create({
        data: {
          id,
          domain: learning.domain,
          category: learning.category,
          pattern: learning.pattern,
          confidence: learning.confidence,
          sourceTaskId: learning.source_task_id,
          created: new Date(),
        },
      });
    } catch (err: unknown) {
      // Unique constraint violation = duplicate, silently ignore
      const code = (err as { code?: string }).code;
      if (code === "P2002") return;
      throw err;
    }
  }

  // --- Session Log ---

  async loadPreviousSession(): Promise<SessionEntry[]> {
    const rows = await prisma.sessionEntry.findMany({
      orderBy: { timestamp: "desc" },
      take: 20,
    });
    // Reverse so they're chronological
    rows.reverse();
    return rows.map((r) => ({
      timestamp: r.timestamp.toISOString(),
      role: r.role as SessionEntry["role"],
      content: r.content,
      mode: r.mode ?? undefined,
      cost_usd: r.costUsd ?? undefined,
    }));
  }

  addSessionEntry(entry: Omit<SessionEntry, "timestamp">): void {
    // Fire-and-forget DB write so it doesn't block the CLI
    prisma.sessionEntry
      .create({
        data: {
          sessionId: this.sessionId,
          timestamp: new Date(),
          role: entry.role,
          content: entry.content,
          mode: entry.mode ?? null,
          costUsd: entry.cost_usd ?? null,
        },
      })
      .catch(() => {});
  }

  async saveSession(): Promise<void> {
    // Entries are persisted individually via addSessionEntry — nothing to flush.
  }

  getSessionLog() {
    return {
      sessionId: this.sessionId,
      started: new Date().toISOString(),
      entries: [] as SessionEntry[],
    };
  }
}
