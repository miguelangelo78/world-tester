"use client";

import { useState } from "react";
import { Wand2, Loader } from "lucide-react";
import { getApiUrl } from "@/config/api";

interface StepGeneratorProps {
  prompt: string;
  domain?: string;
  onGeneratedSteps: (steps: Array<{ instruction: string }>) => void;
  isLoading?: boolean;
}

export const E2EStepGenerator: React.FC<StepGeneratorProps> = ({
  prompt,
  domain,
  onGeneratedSteps,
  isLoading = false,
}) => {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSteps = async () => {
    if (!prompt.trim()) {
      setError("Please enter a test description");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const apiUrl = getApiUrl("/api/e2e/generate-steps");
      console.log("[E2E] Generating steps, API URL:", apiUrl);
      
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...(domain && { domain }) }),
      });

      if (!response.ok) throw new Error("Failed to generate steps");
      
      const { steps } = await response.json();
      onGeneratedSteps(steps);
    } catch (err) {
      console.error("Error generating steps:", err);
      setError("Failed to generate steps. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={generateSteps}
        disabled={generating || isLoading || !prompt.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
      >
        {generating ? (
          <>
            <Loader size={18} className="animate-spin" />
            Generating Steps...
          </>
        ) : (
          <>
            <Wand2 size={18} />
            AI Generate Steps
          </>
        )}
      </button>

      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-md">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        💡 Describe what you want to test in natural language, and the AI will generate steps for you
      </p>
    </div>
  );
};
