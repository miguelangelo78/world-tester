import React, { useState, useEffect } from "react";
import { Play, Edit, Trash2, Clock, BarChart3, Search, Loader, Globe, X } from "lucide-react";
import { getApiUrl } from "@/config/api";

interface TestMetrics {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  lastRun?: {
    status: "passed" | "failed" | "running";
    date: string;
    durationMs: number;
    cost: number;
  };
  nextScheduled?: string;
  passRate: number;
  totalRuns: number;
  averageCost: number;
  totalCost: number;
  averageDuration: number;
}

interface E2EDashboardProps {
  onCreateTest: () => void;
  onEditTest: (testId: string) => void;
  onRunTest: (testId: string) => Promise<void>;
  onDeleteTest: (testId: string) => Promise<void>;
  onViewResults: (testId: string) => void;
  isLoading?: boolean;
}

export const E2EDashboard: React.FC<E2EDashboardProps> = ({
  onCreateTest,
  onEditTest,
  onRunTest,
  onDeleteTest,
  onViewResults,
  isLoading = false,
}) => {
  const [tests, setTests] = useState<TestMetrics[]>([]);
  const [filteredTests, setFilteredTests] = useState<TestMetrics[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);
  const [runningTests, setRunningTests] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchTests = async () => {
      try {
        // Fetch tests, optionally filtered by selected domain
        const testsUrl = selectedDomain 
          ? getApiUrl(`/api/e2e/tests?domain=${encodeURIComponent(selectedDomain)}`)
          : getApiUrl("/api/e2e/tests");
        
        const response = await fetch(testsUrl);
        if (!response.ok) throw new Error("Failed to fetch tests");
        const data = await response.json();
        
        // Transform data to ensure all required properties exist with defaults
        const transformedTests = (Array.isArray(data) ? data : []).map((test: any) => ({
          id: test.id || "",
          name: test.name || "Untitled Test",
          description: test.description || "",
          domain: test.domain || "",
          lastRun: test.lastRun || undefined,
          nextScheduled: test.nextScheduled || undefined,
          passRate: typeof test.passRate === "number" ? test.passRate : 0,
          totalRuns: typeof test.totalRuns === "number" ? test.totalRuns : 0,
          averageCost: typeof test.averageCost === "number" ? test.averageCost : 0,
          totalCost: typeof test.totalCost === "number" ? test.totalCost : 0,
          averageDuration: typeof test.averageDuration === "number" ? test.averageDuration : 0,
        }));
        
        setTests(transformedTests);
        setFilteredTests(transformedTests);
        
        // Check if any running tests have completed
        setRunningTests((prev) => {
          const updated = new Set(prev);
          for (const testId of prev) {
            const test = transformedTests.find(t => t.id === testId);
            // Only remove from running tests if we have explicit confirmation it's NOT running
            // Check if the current run's status is explicitly "passed" or "failed"
            // AND the run completion time has been set (meaning it finished)
            if (test?.lastRun && test.lastRun.status && 
                (test.lastRun.status === "passed" || test.lastRun.status === "failed")) {
              // Test has completed, remove from running
              updated.delete(testId);
            }
          }
          return updated;
        });
      } catch (error) {
        console.error("Error fetching tests:", error);
        setTests([]);
        setFilteredTests([]);
      }
    };

    // Fetch available domains (only on initial load or when no domain is selected)
    const fetchDomains = async () => {
      try {
        const response = await fetch(getApiUrl("/api/e2e/domains"));
        if (!response.ok) throw new Error("Failed to fetch domains");
        const data = await response.json();
        const domains = Array.isArray(data.domains) ? data.domains.filter((d: any) => d) : [];
        setAvailableDomains(domains);
      } catch (error) {
        console.error("Error fetching domains:", error);
        setAvailableDomains([]);
      }
    };

    // Initial fetch
    fetchTests();
    fetchDomains();
    
    // Always poll for updates every 2 seconds to catch completed tests and updated costs
    const pollInterval = setInterval(() => {
      fetchTests();
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [selectedDomain]);

  // Search filtering
  useEffect(() => {
    const filtered = tests.filter(
      (test) =>
        (test.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        test.description?.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    setFilteredTests(filtered);
  }, [searchTerm, tests]);

  const handleRunTest = async (testId: string) => {
    setRunningTests((prev) => new Set([...prev, testId]));
    try {
      await onRunTest(testId);
      // Don't remove from runningTests here - keep it running until polling detects completion
      // We'll monitor the lastRun status to determine when to remove it
    } catch (err) {
      console.error("Failed to run test:", err);
      // Remove from running on error
      setRunningTests((prev) => {
        const next = new Set(prev);
        next.delete(testId);
        return next;
      });
    }
  };

  const handleDeleteTest = async (testId: string) => {
    if (!confirm("Are you sure you want to delete this test?")) return;
    try {
      await onDeleteTest(testId);
      setTests((prev) => prev.filter((t) => t.id !== testId));
    } catch (err) {
      console.error("Failed to delete test:", err);
    }
  };

  const totalPassRate = tests.length > 0 ? tests.reduce((sum, t) => sum + (t.passRate || 0), 0) / tests.length : 0;
  const totalTests = tests.reduce((sum, t) => sum + (t.totalRuns || 0), 0) || 0;
  const totalCost = tests.reduce((sum, t) => sum + (t.totalCost || 0), 0) || 0;

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">E2E</h1>
            <p className="text-muted-foreground mt-1">Manage and monitor your end-to-end tests</p>
          </div>
          <button
            onClick={onCreateTest}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium"
          >
            + Create Test
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-card border border-border rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Total Tests</p>
                <p className="text-3xl font-bold text-foreground mt-1">{tests.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <span className="text-2xl">📋</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Total Runs</p>
                <p className="text-3xl font-bold text-foreground mt-1">{isFinite(totalTests) ? totalTests : 0}</p>
              </div>
              <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                <Play size={24} className="text-green-500" />
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Pass Rate</p>
                <p className="text-3xl font-bold text-foreground mt-1">{isFinite(totalPassRate * 100) ? (totalPassRate * 100).toFixed(1) : "0"}%</p>
              </div>
              <div className="w-12 h-12 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                <BarChart3 size={24} className="text-yellow-500" />
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Total Cost</p>
                <p className="text-3xl font-bold text-foreground mt-1">${isFinite(totalCost) ? totalCost.toFixed(2) : "0.00"}</p>
              </div>
              <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <span className="text-2xl">💰</span>
              </div>
            </div>
          </div>
        </div>

        {/* Domain Selector */}
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Globe size={18} className="text-muted-foreground" />
              <label className="text-sm font-medium text-foreground">Domain:</label>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedDomain || ""}
                onChange={(e) => setSelectedDomain(e.target.value || null)}
                className="px-3 py-2 border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Domains</option>
                {availableDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
              {selectedDomain && (
                <button
                  onClick={() => setSelectedDomain(null)}
                  className="p-2 hover:bg-accent text-muted-foreground rounded transition-colors"
                  title="Clear domain filter"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-muted-foreground" size={20} />
            <input
              type="text"
              placeholder="Search tests by name or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Tests Table */}
        <div className="bg-card border border-border rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Test</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Domain</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Status</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Pass Rate</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Runs</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-foreground">Cost</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <p className="text-muted-foreground">
                      {tests.length === 0 ? "No tests created yet. Create your first test!" : "No tests match your search."}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredTests.map((test) => (
                  <tr 
                    key={test.id} 
                    className={`border-b border-border transition-all ${
                      runningTests.has(test.id) 
                        ? "bg-blue-500/10 hover:bg-blue-500/20" 
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {runningTests.has(test.id) && (
                          <div className="flex-shrink-0">
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-foreground text-sm">{test.name}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{test.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-foreground text-xs">
                        <Globe size={12} />
                        {test.domain || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {runningTests.has(test.id) ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                          <span>Running</span>
                        </span>
                      ) : test.lastRun ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                            test.lastRun.status === "passed"
                              ? "bg-green-500/20 text-green-500"
                              : "bg-red-500/20 text-red-500"
                          }`}
                        >
                          {test.lastRun.status === "passed" ? "✓" : "✗"}
                          <span>{test.lastRun.status === "passed" ? "Passed" : "Failed"}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-8 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500"
                            style={{ width: `${isFinite(test.passRate * 100) ? test.passRate * 100 : 0}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{isFinite(test.passRate * 100) ? (test.passRate * 100).toFixed(0) : "0"}%</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-foreground font-medium">
                      {test.totalRuns || 0}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-foreground">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-medium">${isFinite(test.totalCost) ? test.totalCost.toFixed(2) : "0.00"}</span>
                        <span className="text-xs text-muted-foreground">avg: ${isFinite(test.averageCost) ? test.averageCost.toFixed(2) : "0.00"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleRunTest(test.id)}
                          disabled={runningTests.has(test.id)}
                          className="p-1.5 hover:bg-primary/20 text-primary rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                          title="Run test"
                        >
                          {runningTests.has(test.id) ? (
                            <Loader size={14} className="animate-spin" />
                          ) : (
                            <Play size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => onViewResults(test.id)}
                          className="p-1.5 hover:bg-accent text-muted-foreground rounded"
                          title="View results"
                        >
                          <BarChart3 size={14} />
                        </button>
                        <button
                          onClick={() => onEditTest(test.id)}
                          className="p-1.5 hover:bg-accent text-muted-foreground rounded"
                          title="Edit test"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteTest(test.id)}
                          className="p-1.5 hover:bg-red-500/20 text-red-500 rounded"
                          title="Delete test"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default E2EDashboard;
