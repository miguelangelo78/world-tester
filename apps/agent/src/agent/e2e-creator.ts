import { GoogleGenerativeAI } from "@google/generative-ai";

export interface E2ETestCreationRequest {
  instruction: string;
  domain?: string;
}

export interface E2ETestStep {
  id: string;
  instruction: string;
  order: number;
}

export interface E2ETest {
  name: string;
  description: string;
  domain: string;
  steps: E2ETestStep[];
  retryCount: number;
  strictnessLevel: "low" | "medium" | "high";
  visualRegressionEnabled: boolean;
  autoApproveBaseline: boolean;
}

/**
 * Parse user's conversational test description into structured E2E test
 */
export async function parseE2ETestFromConversation(
  request: E2ETestCreationRequest,
  apiKey: string,
): Promise<E2ETest> {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `You are a QA expert creating clear, executable E2E test steps.

Test description: "${request.instruction}"
Target domain: "${request.domain || "unknown"}"

Generate a JSON object with this structure (no markdown):
{
  "name": "Short name (2-5 words)",
  "description": "What this test verifies (1 sentence)",
  "steps": [
    "Step text here",
    "..."
  ]
}

CRITICAL RULES FOR STEPS:
- Use simple, direct language only
- Each step = ONE action (click, fill, type, navigate, wait, verify, check)
- Be specific: "Click the Login button" not "Click the login button if it exists"
- Under 20 words per step
- Start with verbs: click, fill, type, navigate, wait, verify, scroll, hover, select, press

Example:
{
  "name": "Login flow",
  "description": "Tests user login process",
  "steps": [
    "Navigate to https://example.com/login",
    "Type user@example.com in the email field",
    "Type password123 in the password field",
    "Click the Login button",
    "Verify Welcome message is visible",
    "Verify Dashboard page loaded"
  ]
}`;

  try {
    const response = await model.generateContent(prompt);
    let text = response.response.text();

    // Strip markdown code fences if present
    text = text
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    // Parse the JSON response
    const parsed = JSON.parse(text);

    // Transform into E2ETest structure
    const steps: E2ETestStep[] = (parsed.steps || []).map(
      (instruction: string, index: number) => ({
        id: `step-${index}-${Date.now()}`,
        instruction,
        order: index,
      })
    );

    return {
      name: parsed.name || "Untitled Test",
      description: parsed.description || "",
      domain: request.domain || "example.com",
      steps,
      retryCount: 2,
      strictnessLevel: "high",
      visualRegressionEnabled: true,
      autoApproveBaseline: false,
    };
  } catch (error) {
    console.error("[E2E Creator] Failed to parse test:", error);
    throw new Error(
      `Failed to create E2E test from description: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
