import prisma from "../db.js";
import {
  SiteKnowledge,
  TaskRecord,
  Learning,
  SessionEntry,
} from "./types.js";
import type {
  ConversationInfo,
  ConversationMessageDTO,
  ConversationMessageType,
} from "@world-tester/shared";

export interface AddMessageInput {
  role: "user" | "agent" | "system";
  type: ConversationMessageType;
  content: string;
  mode?: string;
  costUsd?: number;
  commandId?: string;
}

export class MemoryManager {
  private sessionId: string;
  private _activeConversationId = "";

  constructor(_dataDir: string) {
    this.sessionId = Date.now().toString(36);
  }

  get activeConversationId(): string {
    return this._activeConversationId;
  }

  async init(): Promise<void> {
    // Resume latest active conversation or create a default one
    const latest = await prisma.conversation.findFirst({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
    });

    if (latest) {
      this._activeConversationId = latest.id;
    } else {
      const conv = await this.createConversation("Default Conversation");
      this._activeConversationId = conv.id;
    }
  }

  // --- Conversations ---

  async createConversation(title?: string): Promise<ConversationInfo> {
    const row = await prisma.conversation.create({
      data: { title: title ?? "New Conversation" },
    });
    this._activeConversationId = row.id;
    return this.toConversationInfo(row, 0);
  }

  async listConversations(): Promise<ConversationInfo[]> {
    const rows = await prisma.conversation.findMany({
      where: { status: "active" },
      orderBy: { updatedAt: "desc" },
    });
    const counts = await prisma.conversationMessage.groupBy({
      by: ["conversationId"],
      _count: true,
      where: { conversationId: { in: rows.map((r) => r.id) } },
    });
    const countMap = new Map(counts.map((c) => [c.conversationId, c._count]));
    return rows.map((r) => this.toConversationInfo(r, countMap.get(r.id) ?? 0));
  }

  async switchConversation(id: string): Promise<ConversationMessageDTO[]> {
    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv || conv.status !== "active") {
      throw new Error(`Conversation "${id}" not found or archived`);
    }
    this._activeConversationId = id;
    return this.getConversationMessages(id);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await prisma.conversation.update({ where: { id }, data: { title } });
  }

  async archiveConversation(id: string): Promise<void> {
    await prisma.conversation.update({ where: { id }, data: { status: "archived" } });
    if (this._activeConversationId === id) {
      const next = await prisma.conversation.findFirst({
        where: { status: "active", id: { not: id } },
        orderBy: { updatedAt: "desc" },
      });
      if (next) {
        this._activeConversationId = next.id;
      } else {
        const created = await this.createConversation("New Conversation");
        this._activeConversationId = created.id;
      }
    }
  }

  async getConversationMessages(id: string, limit = 500): Promise<ConversationMessageDTO[]> {
    const rows = await prisma.conversationMessage.findMany({
      where: { conversationId: id },
      orderBy: { timestamp: "asc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      timestamp: r.timestamp.toISOString(),
      role: r.role as ConversationMessageDTO["role"],
      type: r.type as ConversationMessageType,
      content: r.content,
      mode: r.mode ?? undefined,
      costUsd: r.costUsd ?? undefined,
      commandId: r.commandId ?? undefined,
    }));
  }

  async getActiveConversation(): Promise<ConversationInfo | null> {
    if (!this._activeConversationId) return null;
    const row = await prisma.conversation.findUnique({
      where: { id: this._activeConversationId },
    });
    if (!row) return null;
    const count = await prisma.conversationMessage.count({
      where: { conversationId: row.id },
    });
    return this.toConversationInfo(row, count);
  }

  addConversationMessage(msg: AddMessageInput): void {
    if (!this._activeConversationId) return;
    const convId = this._activeConversationId;
    prisma.conversationMessage
      .create({
        data: {
          conversationId: convId,
          role: msg.role,
          type: msg.type,
          content: msg.content,
          mode: msg.mode ?? null,
          costUsd: msg.costUsd ?? null,
          commandId: msg.commandId ?? null,
        },
      })
      .then(() =>
        prisma.conversation.update({
          where: { id: convId },
          data: { updatedAt: new Date() },
        }),
      )
      .catch(() => {});
  }

  async autoTitleConversation(firstCommand: string): Promise<boolean> {
    if (!this._activeConversationId) return false;
    const conv = await prisma.conversation.findUnique({
      where: { id: this._activeConversationId },
    });
    if (!conv) return false;
    const isDefault = conv.title === "New Conversation" || conv.title === "Default Conversation";
    if (!isDefault) return false;
    const title = firstCommand.slice(0, 60).trim() || "Untitled";
    await prisma.conversation.update({
      where: { id: this._activeConversationId },
      data: { title },
    });
    return true;
  }

  async setConversationDomain(domain: string): Promise<void> {
    if (!this._activeConversationId) return;
    await prisma.conversation.update({
      where: { id: this._activeConversationId },
      data: { domain },
    }).catch(() => {});
  }

  private toConversationInfo(
    row: { id: string; title: string; createdAt: Date; updatedAt: Date; status: string; domain: string | null },
    messageCount: number,
  ): ConversationInfo {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      status: row.status as ConversationInfo["status"],
      domain: row.domain ?? undefined,
      messageCount,
    };
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
      const code = (err as { code?: string }).code;
      if (code === "P2002") return;
      throw err;
    }
  }

  // --- Legacy Session Log (kept for backward compat) ---

  async loadPreviousSession(): Promise<SessionEntry[]> {
    // Try loading from the active conversation first
    if (this._activeConversationId) {
      const msgs = await this.getConversationMessages(this._activeConversationId, 30);
      if (msgs.length > 0) {
        return msgs
          .filter((m) => m.role === "user" || m.role === "agent")
          .map((m) => ({
            timestamp: m.timestamp,
            role: m.role as SessionEntry["role"],
            content: m.content,
            mode: m.mode,
            cost_usd: m.costUsd,
          }));
      }
    }
    // Fall back to old SessionEntry table
    const rows = await prisma.sessionEntry.findMany({
      orderBy: { timestamp: "desc" },
      take: 20,
    });
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

  async saveSession(): Promise<void> {}

  getSessionLog() {
    return {
      sessionId: this.sessionId,
      started: new Date().toISOString(),
      entries: [] as SessionEntry[],
    };
  }
}
