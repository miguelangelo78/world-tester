import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppConfig } from "../config/types.js";
import { SiteKnowledge, Learning } from "../memory/types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { TestPlan, TestStep } from "./test-types.js";

/**
 * Decomposes a ticket/description into ordered test steps with expected outcomes.
 * Accepts either free-form text or pre-structured JSON input.
 */
export async function planTest(
  instruction: string,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
  currentUrl: string,
): Promise<TestPlan> {
  // If the user provided structured JSON, parse it directly
  const parsed = tryParseStructured(instruction);
  if (parsed) return parsed;

  // Use Gemini Flash to decompose the ticket into steps
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const knowledgeContext = buildSystemPrompt(siteKnowledge, learnings, {
    skipBasePrompt: true,
  });

  const systemText = [
    `You are a senior QA test planner. Given a ticket or test description, decompose it into precise, ordered test steps.`,
    `The browser is currently on: ${currentUrl}`,
    knowledgeContext || "",
    ``,
    `Respond with EXACTLY one JSON object (no markdown, no backticks):`,
    `{`,
    `  "title": "short test title",`,
    `  "steps": [`,
    `    { "action": "what to do", "expected": "what should happen", "critical": true/false, "setup": true/false }`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- Each step should be a single, verifiable action.`,
    `- "action" should be specific enough for a browser agent to execute (e.g., "Navigate to /account" not "go to settings").`,
    `- "expected" should be a concrete, observable outcome (e.g., "Page shows 'Account Settings' heading" not "page loads").`,
    `- "critical": if true and this step fails, remaining steps are skipped (e.g., navigation, login, loading data).`,
    `- "setup": if true, this step is a prerequisite (navigation, waiting, locating elements) — NOT the actual test assertion. Setup steps do NOT count toward the final pass/fail verdict. Only non-setup steps determine the verdict.`,
    `- IMPORTANT: Navigation, page loading, waiting for data, and locating/identifying elements are ALWAYS setup steps. The actual verification/assertion of the test condition is NEVER a setup step.`,
    `- Include 3-10 steps. Be thorough but don't over-decompose.`,
    `- The first step is usually navigation — critical AND setup.`,
    `- The final steps should be the actual assertions that verify the test goal — critical but NOT setup.`,
  ].join("\n");

  const model = genAI.getGenerativeModel({
    model: config.utilityModel.replace("google/", ""),
    systemInstruction: { role: "user", parts: [{ text: systemText }] },
  });

  const result = await model.generateContent(instruction);
  const raw = result.response.text().trim();

  return parsePlanResponse(raw, instruction);
}

function parseStep(s: Record<string, unknown>): TestStep {
  return {
    action: String(s.action ?? ""),
    expected: String(s.expected ?? ""),
    critical: s.critical !== false,
    setup: s.setup === true,
    browser: typeof s.browser === "string" ? s.browser : undefined,
  };
}

function tryParseStructured(input: string): TestPlan | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (obj.title && Array.isArray(obj.steps)) {
      return {
        title: obj.title,
        steps: obj.steps.map(parseStep),
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function parsePlanResponse(raw: string, fallbackTitle: string): TestPlan {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const obj = JSON.parse(cleaned);
    if (obj.title && Array.isArray(obj.steps)) {
      return {
        title: String(obj.title),
        steps: obj.steps.map(parseStep),
      };
    }
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        if (Array.isArray(obj.steps)) {
          return {
            title: String(obj.title ?? fallbackTitle),
            steps: obj.steps.map(parseStep),
          };
        }
      } catch {
        // Give up
      }
    }
  }

  return {
    title: fallbackTitle.slice(0, 80),
    steps: [
      {
        action: fallbackTitle,
        expected: "Task completes successfully",
        critical: true,
      },
    ],
  };
}
