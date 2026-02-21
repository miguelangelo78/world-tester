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
    `    { "action": "what to do (be precise, as if instructing a browser agent)", "expected": "what should happen after this action", "critical": true/false }`,
    `  ]`,
    `}`,
    ``,
    `Rules:`,
    `- Each step should be a single, verifiable action.`,
    `- "action" should be specific enough for a browser agent to execute (e.g., "Navigate to /account" not "go to settings").`,
    `- "expected" should be a concrete, observable outcome (e.g., "Page shows 'Account Settings' heading" not "page loads").`,
    `- "critical" means if this step fails, remaining steps cannot proceed (e.g., navigation or login steps are critical, verification-only steps are not).`,
    `- Include 3-10 steps. Be thorough but don't over-decompose.`,
    `- The first step is usually navigation — always critical.`,
    `- Include a final verification step to confirm the overall goal.`,
  ].join("\n");

  const model = genAI.getGenerativeModel({
    model: config.utilityModel.replace("google/", ""),
    systemInstruction: { role: "user", parts: [{ text: systemText }] },
  });

  const result = await model.generateContent(instruction);
  const raw = result.response.text().trim();

  return parsePlanResponse(raw, instruction);
}

function tryParseStructured(input: string): TestPlan | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (obj.title && Array.isArray(obj.steps)) {
      return {
        title: obj.title,
        steps: obj.steps.map((s: Record<string, unknown>) => ({
          action: String(s.action ?? ""),
          expected: String(s.expected ?? ""),
          critical: s.critical !== false,
        })),
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
        steps: obj.steps.map(
          (s: Record<string, unknown>): TestStep => ({
            action: String(s.action ?? ""),
            expected: String(s.expected ?? ""),
            critical: s.critical !== false,
          }),
        ),
      };
    }
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        if (Array.isArray(obj.steps)) {
          return {
            title: String(obj.title ?? fallbackTitle),
            steps: obj.steps.map(
              (s: Record<string, unknown>): TestStep => ({
                action: String(s.action ?? ""),
                expected: String(s.expected ?? ""),
                critical: s.critical !== false,
              }),
            ),
          };
        }
      } catch {
        // Give up
      }
    }
  }

  // Fallback: single-step plan from the raw instruction
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
