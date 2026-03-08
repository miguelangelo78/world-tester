"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { E2EResultsViewer } from "@/components/e2e-results-viewer";

interface ResultsPageProps {
  params: Promise<{
    testId: string;
  }>;
}

export default function ResultsPage({ params }: ResultsPageProps) {
  const router = useRouter();
  const { testId } = use(params);

  const handleRerun = async (testId: string) => {
    try {
      const response = await fetch(`http://localhost:3100/api/e2e/tests/${testId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to run test");
      }
    } catch (err) {
      console.error("Error running test:", err);
      throw err;
    }
  };

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Navigation Header */}
      <div className="border-b border-border bg-card px-6 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-accent text-foreground transition-colors"
            title="Go back"
          >
            <ChevronLeft size={18} />
            Back
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">E2E Tests</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-foreground font-semibold">Test Results</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <E2EResultsViewer
          testId={testId}
          onBack={() => router.back()}
          onRerun={handleRerun}
        />
      </div>
    </div>
  );
}
