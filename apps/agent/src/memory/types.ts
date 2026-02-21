export interface PageKnowledge {
  url: string;
  path: string;
  title?: string;
  description?: string;
  pageType?: string;
  forms?: FormKnowledge[];
  navigation?: string[];
  interactiveElements?: string[];
  dataDisplayed?: string[];
  notes?: string[];
  lastVisited?: string;
}

export interface FormKnowledge {
  name?: string;
  fields: string[];
  submitButton?: string;
  notes?: string;
}

export interface SiteKnowledge {
  domain: string;
  lastUpdated: string;
  siteDescription?: string;
  techStack?: string[];
  authMethod?: string;
  pages: Record<string, PageKnowledge>;
  siteMap: string[];
  commonFlows: string[];
  knownIssues: string[];
  tips: string[];
}

export interface TaskRecord {
  id: string;
  timestamp: string;
  command: string;
  instruction: string;
  mode: string;
  domain?: string;
  steps: string[];
  outcome: "pass" | "fail" | "blocked" | "partial";
  result?: string;
  duration_ms: number;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
}

export type LearningCategory = "navigation" | "recipe" | "gotcha" | "general";

export interface Learning {
  id: string;
  domain: string;
  category: LearningCategory;
  pattern: string;
  confidence: number;
  source_task_id: string;
  created: string;
}

export interface LearningsStore {
  learnings: Learning[];
  lastUpdated: string;
}

export interface SessionEntry {
  timestamp: string;
  role: "user" | "agent";
  content: string;
  mode?: string;
  cost_usd?: number;
}

export interface SessionLog {
  sessionId: string;
  started: string;
  entries: SessionEntry[];
}
