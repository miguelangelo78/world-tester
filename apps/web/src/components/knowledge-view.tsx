"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Brain,
  Map,
  Lightbulb,
  AlertTriangle,
  BookOpen,
  Navigation,
  Wrench,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useAgent } from "./agent-provider";
import { PageHeader } from "./page-header";
import type { WSMessage } from "@world-tester/shared";

interface SiteKnowledge {
  domain: string;
  siteDescription?: string;
  authMethod?: string;
  techStack?: string[];
  pages: Record<string, unknown>;
  siteMap: string[];
  commonFlows: string[];
  tips: string[];
  knownIssues: string[];
}

interface Learning {
  id: string;
  domain: string;
  category: string;
  pattern: string;
  confidence: number;
  created?: string;
}

const categoryIcons: Record<string, typeof BookOpen> = {
  recipe: Wrench,
  navigation: Navigation,
  gotcha: AlertTriangle,
  general: Lightbulb,
};

const categoryLabels: Record<string, string> = {
  recipe: "Recipes",
  navigation: "Navigation",
  gotcha: "Gotchas",
  general: "General",
};

export function KnowledgeView() {
  const { status, sendCommand, onMessage } = useAgent();
  const [knowledge, setKnowledge] = useState<SiteKnowledge | null>(null);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["overview", "learnings"]));

  const fetchKnowledge = useCallback(() => {
    if (status !== "connected") return;
    setLoading(true);
    const id = sendCommand("knowledge");

    const unsub = onMessage((msg: WSMessage) => {
      if (msg.id === id && msg.type === "command_result") {
        try {
          const data = JSON.parse((msg.payload as { message: string }).message);
          setKnowledge(data.siteKnowledge ?? null);
          setLearnings(data.learnings ?? []);
        } catch {
          setKnowledge(null);
          setLearnings([]);
        }
        setLoading(false);
        unsub();
      }
    });
  }, [status, sendCommand, onMessage]);

  useEffect(() => {
    fetchKnowledge();
  }, [fetchKnowledge]);

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group learnings by category
  const groupedLearnings = learnings.reduce<Record<string, Learning[]>>((acc, l) => {
    const cat = l.category ?? "general";
    (acc[cat] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        left={
          <>
            <Brain className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-sm font-medium">Knowledge Base</h1>
            {knowledge && (
              <span className="hidden sm:inline rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {knowledge.domain}
              </span>
            )}
          </>
        }
        right={
          <button
            onClick={fetchKnowledge}
            disabled={status !== "connected" || loading}
            className="rounded-md bg-accent px-3 py-1 text-xs text-accent-foreground hover:bg-accent/80 disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {status !== "connected" ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Connect to the agent to view knowledge.
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Loading knowledge...
          </div>
        ) : !knowledge && learnings.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            No knowledge yet. Use &quot;l:&quot; to learn a website.
          </div>
        ) : (
          <>
            {/* Site Overview */}
            {knowledge && (
              <Section
                id="overview"
                title="Site Overview"
                icon={<BookOpen className="h-3.5 w-3.5" />}
                expanded={expandedSections.has("overview")}
                onToggle={() => toggleSection("overview")}
              >
                <div className="space-y-2 text-xs">
                  {knowledge.siteDescription && (
                    <p>{knowledge.siteDescription}</p>
                  )}
                  {knowledge.authMethod && (
                    <div className="text-muted-foreground">
                      Auth: <span className="text-foreground">{knowledge.authMethod}</span>
                    </div>
                  )}
                  {knowledge.techStack && knowledge.techStack.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {knowledge.techStack.map((t) => (
                        <span key={t} className="rounded bg-accent px-1.5 py-0.5 text-[10px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Site Map */}
            {knowledge && knowledge.siteMap.length > 0 && (
              <Section
                id="sitemap"
                title={`Site Map (${knowledge.siteMap.length})`}
                icon={<Map className="h-3.5 w-3.5" />}
                expanded={expandedSections.has("sitemap")}
                onToggle={() => toggleSection("sitemap")}
              >
                <div className="space-y-0.5 text-xs font-mono">
                  {knowledge.siteMap.map((path) => (
                    <div key={path} className="text-muted-foreground">{path}</div>
                  ))}
                </div>
              </Section>
            )}

            {/* Flows */}
            {knowledge && knowledge.commonFlows.length > 0 && (
              <Section
                id="flows"
                title={`Flows (${knowledge.commonFlows.length})`}
                icon={<Navigation className="h-3.5 w-3.5" />}
                expanded={expandedSections.has("flows")}
                onToggle={() => toggleSection("flows")}
              >
                <div className="space-y-1 text-xs">
                  {knowledge.commonFlows.map((flow, idx) => (
                    <div key={idx} className="text-muted-foreground">• {flow}</div>
                  ))}
                </div>
              </Section>
            )}

            {/* Tips & Issues */}
            {knowledge && (knowledge.tips.length > 0 || knowledge.knownIssues.length > 0) && (
              <Section
                id="tips"
                title="Tips & Known Issues"
                icon={<Lightbulb className="h-3.5 w-3.5" />}
                expanded={expandedSections.has("tips")}
                onToggle={() => toggleSection("tips")}
              >
                <div className="space-y-2 text-xs">
                  {knowledge.tips.map((tip, idx) => (
                    <div key={`tip-${idx}`} className="flex gap-2">
                      <Lightbulb className="h-3 w-3 flex-shrink-0 text-warning mt-0.5" />
                      <span className="text-muted-foreground">{tip}</span>
                    </div>
                  ))}
                  {knowledge.knownIssues.map((issue, idx) => (
                    <div key={`issue-${idx}`} className="flex gap-2">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0 text-destructive mt-0.5" />
                      <span className="text-muted-foreground">{issue}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Learnings */}
            {learnings.length > 0 && (
              <Section
                id="learnings"
                title={`Learnings (${learnings.length})`}
                icon={<Brain className="h-3.5 w-3.5" />}
                expanded={expandedSections.has("learnings")}
                onToggle={() => toggleSection("learnings")}
              >
                <div className="space-y-3">
                  {Object.entries(groupedLearnings).map(([cat, items]) => {
                    const CatIcon = categoryIcons[cat] ?? Lightbulb;
                    return (
                      <div key={cat}>
                        <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                          <CatIcon className="h-3 w-3 text-muted-foreground" />
                          {categoryLabels[cat] ?? cat}
                        </div>
                        <div className="space-y-1 ml-4">
                          {items.map((l) => (
                            <div key={l.id} className="flex items-start gap-2 text-[11px]">
                              <span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground flex-shrink-0">
                                {(l.confidence * 100).toFixed(0)}%
                              </span>
                              <span className="text-muted-foreground">{l.pattern}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium hover:bg-accent/30"
        onClick={onToggle}
        data-section={id}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {icon}
        {title}
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-3">{children}</div>
      )}
    </div>
  );
}
