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

  const prompt = `You are a QA expert. Convert the following test description into a structured E2E test.

User's test description: "${request.instruction}"
Target domain: "${request.domain || "unknown"}"

Respond with a JSON object (no markdown, just raw JSON) with this structure:
{
  "name": "Descriptive test name (2-5 words)",
  "description": "What this test verifies (1 sentence)",
  "steps": [
    "Step 1 in natural language",
    "Step 2 in natural language",
    "etc..."
  ]
}

Guidelines:
- Name should be concise and descriptive
- Steps should be clear, actionable browser commands
- Include at least "Navigate to..." as the first step if no URL is specified
- Steps should be in logical order
- Each step should be a complete action (click button, verify text, enter credentials, etc.)

Example output:
{
  "name": "Login and dashboard verification",
  "description": "Verifies users can log in and reach the dashboard",
  "steps": [
    "Navigate to the homepage",
    "Click the login button",
    "Enter username and password",
    "Click submit",
    "Verify the dashboard page loads"
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
