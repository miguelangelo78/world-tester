"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { E2EDashboard } from "@/components/e2e-dashboard";
import { E2ETestDesigner, type E2ETestDesignerProps } from "@/components/e2e-test-designer";
import { useNotification } from "@/components/notification-provider";
import { getApiUrl } from "@/config/api";

type View = "dashboard" | "designer";
type TestDefinition = Parameters<E2ETestDesignerProps["onSave"]>[0];

interface NavigationState {
  view: View;
  testId: string | null;
  testName?: string;
}

export default function E2EPage() {
  const router = useRouter();
  const { success, error } = useNotification();
  const [navigationHistory, setNavigationHistory] = useState<NavigationState[]>([
    { view: "dashboard", testId: null },
  ]);

  const currentState = navigationHistory[navigationHistory.length - 1];

  const navigateTo = (newState: Omit<NavigationState, "view"> & { view: View }) => {
    setNavigationHistory((prev) => [...prev, newState]);
  };

  const navigateBack = () => {
    setNavigationHistory((prev) =>
      prev.length > 1 ? prev.slice(0, -1) : prev
    );
  };

  const handleCreateTest = () => {
    navigateTo({ view: "designer", testId: null, testName: "Create New Test" });
  };

  const handleEditTest = (testId: string, testName?: string) => {
    navigateTo({ view: "designer", testId, testName });
  };

  const handleRunTest = async (testId: string) => {
    try {
      const response = await fetch(getApiUrl(`/api/e2e/tests/${testId}/run`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to run test");
      }
      
      success("Test started", "Your test is now running in the background");
    } catch (err) {
      console.error("Error running test:", err);
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      error("Failed to run test", errorMsg);
    }
  };

  const handleDeleteTest = async (testId: string) => {
    try {
      const response = await fetch(getApiUrl(`/api/e2e/tests/${testId}`), {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete test");
      success("Test deleted successfully", "The test has been removed");
    } catch (err) {
      console.error("Error deleting test:", err);
      error("Failed to delete test", "Could not remove the test. Please try again");
    }
  };

  const handleViewResults = (testId: string, testName?: string) => {
    router.push(`/e2e/results/${testId}`);
  };

  const handleSaveTest = async (test: TestDefinition) => {
    try {
      const url = currentState.testId
        ? getApiUrl(`/api/e2e/tests/${currentState.testId}`)
        : getApiUrl(`/api/e2e/tests`);

      const method = currentState.testId ? "PUT" : "POST";
      
      console.log("[E2E] Saving test:", { url, method, test });

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(test),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save test (${response.status})`);
      }
      success("Test saved successfully", "Your test has been saved and is ready to use");
      setNavigationHistory([{ view: "dashboard", testId: null }]);
    } catch (err) {
      console.error("Error saving test:", err);
      error("Failed to save test", err instanceof Error ? err.message : "Could not save your test. Please try again");
    }
  };

  const getBreadcrumb = () => {
    const crumbs = [];
    crumbs.push({ label: "E2E Tests", view: "dashboard" as const });

    if (currentState.view === "designer") {
      crumbs.push({ label: currentState.testName || "Edit Test", view: "designer" as const });
    }

    return crumbs;
  };

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      {/* Navigation Header */}
      <div className="border-b border-border bg-card px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {navigationHistory.length > 1 && (
            <button
              onClick={navigateBack}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-accent text-foreground transition-colors"
              title="Go back"
            >
              <ChevronLeft size={18} />
              Back
            </button>
          )}

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            {getBreadcrumb().map((crumb, idx) => (
              <div key={idx} className="flex items-center gap-2">
                {idx > 0 && <span className="text-muted-foreground">/</span>}
                <span className={idx === getBreadcrumb().length - 1 ? "text-foreground font-semibold" : "text-muted-foreground"}>
                  {crumb.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1">
        {currentState.view === "dashboard" && (
          <E2EDashboard
            onCreateTest={handleCreateTest}
            onEditTest={handleEditTest}
            onRunTest={handleRunTest}
            onDeleteTest={handleDeleteTest}
            onViewResults={handleViewResults}
          />
        )}
        {currentState.view === "designer" && (
          <E2ETestDesigner
            testId={currentState.testId || undefined}
            onSave={handleSaveTest}
            onCancel={navigateBack}
          />
        )}
      </div>
    </div>
  );
}
