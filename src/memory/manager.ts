import fs from "fs/promises";
import path from "path";
import {
  SiteKnowledge,
  TaskRecord,
  LearningsStore,
  Learning,
  SessionLog,
  SessionEntry,
} from "./types.js";

export class MemoryManager {
  private dataDir: string;
  private sessionLog: SessionLog;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.sessionLog = {
      sessionId: Date.now().toString(36),
      started: new Date().toISOString(),
      entries: [],
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.dataDir, "site-knowledge"), {
      recursive: true,
    });
    await fs.mkdir(path.join(this.dataDir, "task-history"), {
      recursive: true,
    });
  }

  // --- Site Knowledge ---

  async getSiteKnowledge(domain: string): Promise<SiteKnowledge | null> {
    const filePath = path.join(
      this.dataDir,
      "site-knowledge",
      `${sanitizeFilename(domain)}.json`,
    );
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Partial<SiteKnowledge>;
      return {
        domain: data.domain ?? domain,
        lastUpdated: data.lastUpdated ?? new Date().toISOString(),
        pages: data.pages ?? {},
        siteMap: data.siteMap ?? [],
        commonFlows: data.commonFlows ?? [],
        knownIssues: data.knownIssues ?? [],
        tips: data.tips ?? [],
        siteDescription: data.siteDescription,
        techStack: data.techStack,
        authMethod: data.authMethod,
      };
    } catch {
      return null;
    }
  }

  async saveSiteKnowledge(knowledge: SiteKnowledge): Promise<void> {
    const filePath = path.join(
      this.dataDir,
      "site-knowledge",
      `${sanitizeFilename(knowledge.domain)}.json`,
    );
    knowledge.lastUpdated = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(knowledge, null, 2));
  }

  // --- Task History ---

  async saveTaskRecord(record: TaskRecord): Promise<void> {
    const slug = record.instruction
      .slice(0, 40)
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .toLowerCase();
    const filename = `${record.timestamp.replace(/[:.]/g, "-")}-${slug}.json`;
    const filePath = path.join(this.dataDir, "task-history", filename);
    await fs.writeFile(filePath, JSON.stringify(record, null, 2));
  }

  async getRecentTasks(limit = 10): Promise<TaskRecord[]> {
    const dir = path.join(this.dataDir, "task-history");
    try {
      const files = await fs.readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
      const tasks: TaskRecord[] = [];
      for (const file of jsonFiles) {
        const raw = await fs.readFile(path.join(dir, file), "utf-8");
        tasks.push(JSON.parse(raw));
      }
      return tasks;
    } catch {
      return [];
    }
  }

  // --- Learnings ---

  async getLearnings(domain?: string): Promise<Learning[]> {
    const store = await this.loadLearningsStore();
    if (!domain) return store.learnings;
    return store.learnings.filter((l) => l.domain === domain || l.domain === "*");
  }

  async addLearning(learning: Omit<Learning, "id" | "created">): Promise<void> {
    const store = await this.loadLearningsStore();
    const isDuplicate = store.learnings.some(
      (l) => l.domain === learning.domain && l.pattern === learning.pattern,
    );
    if (isDuplicate) return;

    store.learnings.push({
      ...learning,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      created: new Date().toISOString(),
    });
    store.lastUpdated = new Date().toISOString();
    await this.saveLearningsStore(store);
  }

  private async loadLearningsStore(): Promise<LearningsStore> {
    const filePath = path.join(this.dataDir, "learnings.json");
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const store = JSON.parse(raw) as LearningsStore;
      for (const l of store.learnings) {
        if (!l.category) l.category = "general";
      }
      return store;
    } catch {
      return { learnings: [], lastUpdated: new Date().toISOString() };
    }
  }

  private async saveLearningsStore(store: LearningsStore): Promise<void> {
    const filePath = path.join(this.dataDir, "learnings.json");
    await fs.writeFile(filePath, JSON.stringify(store, null, 2));
  }

  // --- Session Log ---

  addSessionEntry(entry: Omit<SessionEntry, "timestamp">): void {
    this.sessionLog.entries.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
  }

  async saveSession(): Promise<void> {
    const filePath = path.join(this.dataDir, "session-log.json");
    await fs.writeFile(filePath, JSON.stringify(this.sessionLog, null, 2));
  }

  getSessionLog(): SessionLog {
    return this.sessionLog;
  }
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9.-]/g, "_").toLowerCase();
}
