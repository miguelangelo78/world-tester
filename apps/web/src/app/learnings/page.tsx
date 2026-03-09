"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { LearningsViewer } from "@/components/learnings-viewer";

export default function LearningsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <h1 className="text-xl font-semibold">Domain Learnings</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto p-6">
        <div className="space-y-4 mb-6">
          <p className="text-muted-foreground">
            View and manage learnings collected from both E2E tests and agent interactions.
            These learnings improve future test generation and execution.
          </p>
        </div>

        <LearningsViewer />
      </div>
    </div>
  );
}
