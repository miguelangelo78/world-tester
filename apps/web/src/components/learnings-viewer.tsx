"use client";

import { useState, useEffect } from "react";
import { Trash2, RefreshCw, Loader } from "lucide-react";
import { getApiUrl } from "@/config/api";
import { useNotification } from "./notification-provider";
import { useConfirmation } from "./confirmation-dialog";

interface Learning {
  pattern: string;
  category: string;
  confidence: number;
  source: "e2e" | "general";
}

interface LearningsViewerProps {
  domain?: string;
}

export const LearningsViewer: React.FC<LearningsViewerProps> = ({ domain }) => {
  const { success, error } = useNotification();
  const { confirm } = useConfirmation();
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState(domain || "");
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchLearnings = async () => {
    if (!selectedDomain.trim()) {
      setLearnings([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/learnings/domains/${encodeURIComponent(selectedDomain)}`)
      );
      if (!response.ok) throw new Error("Failed to fetch learnings");

      const data = await response.json();
      setLearnings(data.learnings || []);
    } catch (err) {
      console.error("Error fetching learnings:", err);
      error(
        "Failed to fetch learnings",
        err instanceof Error ? err.message : "Unknown error"
      );
      setLearnings([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableDomains = async () => {
    try {
      const response = await fetch(getApiUrl("/api/e2e/domains"));
      if (!response.ok) throw new Error("Failed to fetch domains");

      const data = await response.json();
      const domains = Array.isArray(data.domains) ? data.domains : [];
      setAvailableDomains(domains);
    } catch (err) {
      console.error("Error fetching domains:", err);
    }
  };

  useEffect(() => {
    fetchAvailableDomains();
    if (domain) {
      setSelectedDomain(domain);
    }
  }, [domain]);

  useEffect(() => {
    fetchLearnings();
  }, [selectedDomain]);

  const handleDeleteLearning = async (pattern: string) => {
    // For now, we delete by pattern - ideally we'd have IDs
    // For this we need to match and delete
    setDeleting(pattern);
    try {
      // Delete by filtering learnings (we need ID support in the backend)
      // For now, show success but note this limitation
      error(
        "Delete not fully implemented",
        "Need to add ID-based deletion support"
      );
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteByCategory = async (category: string) => {
    const confirmed = await confirm({
      title: "Delete Category Learnings?",
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
      await fetchLearnings();
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

  const handleDeleteAllForDomain = async () => {
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

  const groupedByCategory = learnings.reduce(
    (acc, learning) => {
      if (!acc[learning.category]) {
        acc[learning.category] = [];
      }
      acc[learning.category].push(learning);
      return acc;
    },
    {} as Record<string, Learning[]>
  );

  return (
    <div className="space-y-6">
      {/* Domain Selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Select Domain</label>
        <select
          value={selectedDomain}
          onChange={(e) => setSelectedDomain(e.target.value)}
          className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
        >
          <option value="">Choose a domain...</option>
          {availableDomains.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {selectedDomain && (
        <>
          {/* Header with refresh and delete all buttons */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Learnings for {selectedDomain}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={fetchLearnings}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-input hover:bg-accent disabled:opacity-50"
              >
                {loading ? (
                  <Loader size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                Refresh
              </button>
              {learnings.length > 0 && (
                <button
                  onClick={handleDeleteAllForDomain}
                  disabled={deleting === "all"}
                  className="flex items-center gap-2 px-3 py-2 rounded-md border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {deleting === "all" ? (
                    <Loader size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete All
                </button>
              )}
            </div>
          </div>

          {/* Learnings by Category */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader className="animate-spin" />
            </div>
          ) : learnings.length === 0 ? (
            <div className="rounded-lg border border-border p-4 text-center text-muted-foreground">
              No learnings found for this domain
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedByCategory).map(([category, items]) => (
                <div key={category} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold capitalize">{category}</h4>
                    <button
                      onClick={() => handleDeleteByCategory(category)}
                      disabled={deleting === category}
                      className="flex items-center gap-2 px-2 py-1 rounded text-sm border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {deleting === category ? (
                        <Loader size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      Delete
                    </button>
                  </div>

                  <div className="space-y-2">
                    {items.map((learning, idx) => (
                      <div
                        key={idx}
                        className="flex items-start justify-between gap-2 p-2 rounded bg-muted/50 text-sm"
                      >
                        <div className="flex-1 space-y-1">
                          <p className="text-foreground">{learning.pattern}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                              {learning.source === "e2e" ? "🤖 E2E" : "👤 General"}
                            </span>
                            <span>
                              Confidence: {Math.round(learning.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Stats */}
          {learnings.length > 0 && (
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="text-muted-foreground">
                Total learnings: <strong>{learnings.length}</strong>
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                {learnings.filter((l) => l.source === "e2e").length} from E2E tests,{" "}
                {learnings.filter((l) => l.source === "general").length} from
                general interactions
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
