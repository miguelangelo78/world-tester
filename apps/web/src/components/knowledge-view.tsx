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
  Trash2,
  RefreshCw,
  Loader,
} from "lucide-react";
import { useAgent } from "./agent-provider";
import { PageHeader } from "./page-header";
import { getApiUrl } from "@/config/api";
import { useNotification } from "./notification-provider";
import { useConfirmation } from "./confirmation-dialog";
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
  const { success, error } = useNotification();
  const { confirm } = useConfirmation();
  const [knowledge, setKnowledge] = useState<SiteKnowledge | null>(null);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["overview", "learnings"]));
  const [selectedDomain, setSelectedDomain] = useState<string>("");
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

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
          if (data.siteKnowledge?.domain) {
            setSelectedDomain(data.siteKnowledge.domain);
          }
        } catch {
          setKnowledge(null);
          setLearnings([]);
        }
        setLoading(false);
        unsub();
      }
    });
  }, [status, sendCommand, onMessage]);

  const fetchAvailableDomains = useCallback(async () => {
    try {
      const response = await fetch(getApiUrl("/api/learnings/domains"));
      if (!response.ok) {
        console.error("Failed to fetch domains:", response.status);
        return;
      }
      const data = await response.json();
      const domains = Array.isArray(data.domains) ? data.domains : [];
      console.log("[Knowledge] Updated available domains:", domains);
      setAvailableDomains(domains);
    } catch (err) {
      console.error("Error fetching domains:", err);
    }
  }, []);

  const handleDomainChange = (domain: string) => {
    setSelectedDomain(domain);
    if (domain && status === "connected") {
      setLoading(true);
      console.log("[Knowledge] Switching to domain:", domain);
      const id = sendCommand(`knowledge:${domain}`);

      const unsub = onMessage((msg: WSMessage) => {
        if (msg.id === id && msg.type === "command_result") {
          try {
            const data = JSON.parse((msg.payload as { message: string }).message);
            console.log("[Knowledge] Received data for domain:", domain, data);
            setKnowledge(data.siteKnowledge ?? null);
            setLearnings(data.learnings ?? []);
          } catch (err) {
            console.error("[Knowledge] Failed to parse response:", err);
            setKnowledge(null);
            setLearnings([]);
          }
          setLoading(false);
          unsub();
        }
      });
    } else {
      console.log("[Knowledge] Cannot switch domain - not connected or domain empty");
    }
  };

  const handleDeleteByCategory = async (category: string) => {
    const confirmed = await confirm({
      title: `Delete ${categoryLabels[category] || category} Learnings?`,
      message: `Delete all ${category} learnings for ${selectedDomain}? This cannot be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      isDangerous: true,
    });

    if (!confirmed) {
      return;
    }

    setDeleting(category);
    try {
      const response = await fetch(
        getApiUrl(
          `/api/learnings/domains/${encodeURIComponent(selectedDomain)}/category/${category}`
        ),
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to delete learnings");

      success("Learnings deleted", `Deleted all ${category} learnings`);
      // Refresh knowledge to update learnings
      if (status === "connected") {
        const id = sendCommand(`knowledge:${selectedDomain}`);
        const unsub = onMessage((msg: WSMessage) => {
          if (msg.id === id && msg.type === "command_result") {
            try {
              const data = JSON.parse((msg.payload as { message: string }).message);
              setLearnings(data.learnings ?? []);
            } catch {
              setLearnings([]);
            }
            unsub();
          }
        });
      }
    } catch (err) {
      console.error("Error deleting learnings:", err);
      error(
        "Failed to delete learnings",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteAllLearnings = async () => {
    const confirmed = await confirm({
      title: "Delete All Learnings?",
      message: `Delete ALL learnings for ${selectedDomain}? This cannot be undone.`,
      confirmLabel: "Delete All",
      cancelLabel: "Cancel",
      isDangerous: true,
    });

    if (!confirmed) {
      return;
    }

    setDeleting("all");
    try {
      const response = await fetch(
        getApiUrl(`/api/learnings/domains/${encodeURIComponent(selectedDomain)}`),
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to delete learnings");

      const data = await response.json();
      success(
        "Learnings deleted",
        `Deleted ${data.deleted} learnings for this domain`
      );
      setLearnings([]);
    } catch (err) {
      console.error("Error deleting learnings:", err);
      error(
        "Failed to delete learnings",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteLearning = async (learningId: string) => {
    setDeleting(learningId);
    try {
      const response = await fetch(
        getApiUrl(`/api/learnings/${learningId}`),
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to delete learning");

      success("Learning deleted", "The learning has been removed");
      setLearnings((prev) => prev.filter((l) => l.id !== learningId));
    } catch (err) {
      console.error("Error deleting learning:", err);
      error(
        "Failed to delete learning",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteDomain = async () => {
    const confirmed = await confirm({
      title: "Delete Entire Domain?",
      message: `Delete ALL knowledge for domain "${selectedDomain}"? This will remove all learnings and knowledge for this domain. This cannot be undone.`,
      confirmLabel: "Delete Domain",
      cancelLabel: "Cancel",
      isDangerous: true,
    });

    if (!confirmed) {
      return;
    }

    setDeleting("domain");
    try {
      console.log("[Knowledge] Deleting domain:", selectedDomain);
      const response = await fetch(
        getApiUrl(`/api/learnings/domains/${encodeURIComponent(selectedDomain)}`),
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to delete domain");

      const data = await response.json();
      console.log("[Knowledge] Domain deleted successfully, refreshing domains list...");
      success(
        "Domain deleted",
        `Deleted all knowledge for ${selectedDomain}`
      );
      
      // Reset state
      setSelectedDomain("");
      setKnowledge(null);
      setLearnings([]);
      
      // Refresh available domains
      console.log("[Knowledge] Fetching updated domains list...");
      await fetchAvailableDomains();
    } catch (err) {
      console.error("Error deleting domain:", err);
      error(
        "Failed to delete domain",
        err instanceof Error ? err.message : "Unknown error"
      );
    } finally {
      setDeleting(null);
    }
  };

  useEffect(() => {
    fetchAvailableDomains();
    fetchKnowledge();
  }, [fetchKnowledge, fetchAvailableDomains]);

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
        {/* Domain Selector */}
        {availableDomains.length > 0 && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground">Switch Domain</label>
            <div className="flex gap-2">
              <select
                value={selectedDomain}
                onChange={(e) => handleDomainChange(e.target.value)}
                disabled={status !== "connected" || loading}
                className="flex-1 px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm disabled:opacity-50"
              >
                <option value="">Choose a domain...</option>
                {availableDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {selectedDomain && (
                <button
                  onClick={handleDeleteDomain}
                  disabled={deleting === "domain"}
                  title="Delete this domain and all its knowledge"
                  className="flex items-center gap-1.5 px-3 py-2 rounded border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50 text-sm"
                >
                  {deleting === "domain" ? (
                    <Loader size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  Delete Domain
                </button>
              )}
            </div>
          </div>
        )}

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
                  {/* Management buttons */}
                  <div className="flex gap-2 mb-3 pb-3 border-b border-border">
                    <button
                      onClick={fetchKnowledge}
                      disabled={status !== "connected" || loading}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-input hover:bg-accent disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      Refresh
                    </button>
                    <button
                      onClick={handleDeleteAllLearnings}
                      disabled={deleting === "all"}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {deleting === "all" ? (
                        <Loader size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Delete All
                    </button>
                  </div>

                  {/* Learnings by category */}
                  {Object.entries(groupedLearnings).map(([cat, items]) => {
                    const CatIcon = categoryIcons[cat] ?? Lightbulb;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between gap-1.5 text-xs font-medium mb-1">
                          <div className="flex items-center gap-1.5">
                            <CatIcon className="h-3 w-3 text-muted-foreground" />
                            {categoryLabels[cat] ?? cat}
                          </div>
                          <button
                            onClick={() => handleDeleteByCategory(cat)}
                            disabled={deleting === cat}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
                          >
                            {deleting === cat ? (
                              <Loader size={10} className="animate-spin" />
                            ) : (
                              <Trash2 size={10} />
                            )}
                            Delete
                          </button>
                        </div>
                        <div className="space-y-1 ml-4">
                          {items.map((l) => (
                            <div key={l.id} className="flex items-start justify-between gap-2 text-[11px] group p-1.5 rounded hover:bg-muted/50">
                              <div className="flex items-start gap-2 flex-1">
                                <span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground flex-shrink-0">
                                  {(l.confidence * 100).toFixed(0)}%
                                </span>
                                <span className="text-muted-foreground">{l.pattern}</span>
                              </div>
                              <button
                                onClick={() => handleDeleteLearning(l.id)}
                                disabled={deleting === l.id}
                                title="Delete this learning"
                                className="flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                {deleting === l.id ? (
                                  <Loader size={12} className="animate-spin text-destructive" />
                                ) : (
                                  <Trash2 size={12} className="text-destructive hover:text-destructive/80 cursor-pointer" />
                                )}
                              </button>
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
