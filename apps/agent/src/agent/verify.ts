import { Stagehand } from "@browserbasehq/stagehand";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AppConfig } from "../config/types.js";

export interface VerifyResult {
  passed: boolean;
  actual: string;
  evidence: string;
}

const ACTION_VERBS = /\b(click|tap|press|type|fill|select|check|uncheck|toggle|scroll|drag|hover|submit)\b/i;

/**
 * Verifies whether a test step's expected outcome was met.
 *
 * For interaction steps (click, type, etc.) the CUA often only reports
 * "Action completed" without describing the visual aftermath. In these
 * cases, the live page state (via extract) is the primary source of truth.
 */
export async function verifyStep(
  stagehand: Stagehand,
  config: AppConfig,
  action: string,
  expected: string,
  cuaMessage: string,
): Promise<VerifyResult> {
  const isInteraction = ACTION_VERBS.test(action);

  // For interaction steps, check the live page FIRST — the CUA message
  // is often just "Action completed" and doesn't describe the visual result.
  if (isInteraction) {
    try {
      const liveResult = await verifyViaExtract(stagehand, action, expected);
      if (liveResult.passed) return liveResult;
    } catch { /* fall through */ }
  }

  // Use the CUA's own report to verify via Gemini Flash
  if (cuaMessage && cuaMessage.length > 20) {
    try {
      const flashResult = await verifyViaFlash(config, action, expected, cuaMessage);
      if (flashResult.passed) return flashResult;

      // Flash said it failed based on the CUA message, but the CUA may have
      // reported before the page finished updating (e.g., SPA filter/transition).
      // Double-check by looking at the live page state (for non-interaction steps
      // that didn't already try this above).
      if (!isInteraction) {
        try {
          const liveResult = await verifyViaExtract(stagehand, action, expected);
          if (liveResult.passed) return liveResult;
        } catch { /* fall through */ }
      }

      return flashResult;
    } catch {
      // Fall through to extract-based verification
    }
  }

  // Final fallback: look at the live page directly
  try {
    return await verifyViaExtract(stagehand, action, expected);
  } catch {
    return heuristicVerify(cuaMessage, expected);
  }
}

async function verifyViaFlash(
  config: AppConfig,
  action: string,
  expected: string,
  cuaMessage: string,
): Promise<VerifyResult> {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const model = genAI.getGenerativeModel({
    model: config.utilityModel.replace("google/", ""),
    systemInstruction: {
      role: "user",
      parts: [{ text: "You are a QA verification engine. Compare expected outcomes against actual results. Be strict but fair." }],
    },
  });

  const isInteraction = ACTION_VERBS.test(action);

  const prompt = [
    `A test step was executed:`,
    `  Action: "${action}"`,
    `  Expected outcome: "${expected}"`,
    ``,
    `The browser agent reported:`,
    `  "${cuaMessage.slice(0, 800)}"`,
    ``,
    `Based on the agent's report, did the expected outcome occur?`,
    ``,
    `IMPORTANT judgment rules:`,
    `- The agent is a VISUAL browser agent. It cannot inspect CSS properties, DOM attributes, or run JavaScript.`,
    `- If the agent visually confirmed the expected outcome (e.g., "the logo appears orange", "the text is visible"),`,
    `  that counts as a PASS — even if the agent also mentioned it couldn't use a specific technical method.`,
    `- Focus on whether the SUBSTANCE of the expected outcome was confirmed, not the METHOD used to confirm it.`,
    `- A visual observation like "appears to be orange" IS valid evidence for "color is orange".`,
    ...(isInteraction ? [
      `- This step is an INTERACTION (click, type, toggle, etc.). If the agent reports the action was completed`,
      `  (e.g., "Action completed", "clicked successfully"), and there is NO indication of an error or failure,`,
      `  then the action itself PASSED. The visual verification of the *result* of that action will be checked`,
      `  in a subsequent assertion step or by a live page inspection — do NOT fail an interaction step just`,
      `  because the agent didn't describe the visual aftermath in its completion message.`,
    ] : []),
    ``,
    `Respond with EXACTLY one JSON object (no markdown, no backticks):`,
    `{"passed": true/false, "actual": "what actually happened", "evidence": "specific detail from the report that proves/disproves"}`,
  ].join("\n");

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();
  return parseVerifyResponse(raw);
}

async function verifyViaExtract(
  stagehand: Stagehand,
  action: string,
  expected: string,
): Promise<VerifyResult> {
  const isInteraction = ACTION_VERBS.test(action);

  const prompt = [
    `You are a QA tester verifying a test step. The action was:`,
    `  "${action}"`,
    ``,
    `The expected outcome is:`,
    `  "${expected}"`,
    ``,
    `Look at the CURRENT state of the page and determine if the expected outcome is satisfied.`,
    ...(isInteraction ? [
      `This was an interaction step (click/type/toggle). The action has already been performed.`,
      `Check whether the PAGE STATE now reflects the expected result of that interaction.`,
      `For example, if the action was "click the dark mode toggle" and expected "switches to light mode",`,
      `check if the page currently shows a light theme (light background, dark text, etc.).`,
    ] : []),
    `Respond with EXACTLY one JSON object (no markdown, no backticks):`,
    `{"passed": true/false, "actual": "what you see on the page right now", "evidence": "specific text or visual cue that proves/disproves the expected outcome"}`,
  ].join("\n");

  const raw: unknown = await stagehand.extract(prompt);

  if (raw && typeof raw === "object" && "passed" in (raw as Record<string, unknown>)) {
    const obj = raw as Record<string, unknown>;
    return {
      passed: Boolean(obj.passed),
      actual: String(obj.actual ?? ""),
      evidence: String(obj.evidence ?? ""),
    };
  }

  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  return parseVerifyResponse(text);
}

function heuristicVerify(cuaMessage: string, expected: string): VerifyResult {
  if (!cuaMessage || cuaMessage.length < 10) {
    return { passed: false, actual: "No response from agent", evidence: "" };
  }

  const msg = cuaMessage.toLowerCase();
  const exp = expected.toLowerCase();

  // Extract key terms from expected outcome
  const keywords = exp
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .filter((w) => !["the", "that", "with", "should", "page", "this", "from", "have", "been", "will"].includes(w));

  const matched = keywords.filter((kw) => msg.includes(kw));
  const ratio = keywords.length > 0 ? matched.length / keywords.length : 0;

  // Check for hard failure signals, but discount "tool limitation" complaints
  // when the agent still visually confirmed the outcome (e.g., "cannot get the
  // computed fill property ... but it appears to be orange").
  const hasVisualConfirmation =
    /(?:appears to be|visually.+(?:is|looks|appears)|based on.+(?:screenshot|visual)|can see|is visible|is displayed)/i.test(cuaMessage);

  const hasFailureSignals =
    /(?:failed|error|unable|could not|couldn't|not found|not visible|did not)/i.test(cuaMessage);

  const effectiveFailure = hasFailureSignals && !hasVisualConfirmation;

  const passed = ratio > 0.4 && !effectiveFailure;

  return {
    passed,
    actual: cuaMessage.slice(0, 300),
    evidence: `Heuristic: ${matched.length}/${keywords.length} keywords matched${effectiveFailure ? ", failure signals detected" : ""}${hasVisualConfirmation ? ", visual confirmation present" : ""}`,
  };
}

function parseVerifyResponse(raw: string): VerifyResult {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const obj = JSON.parse(cleaned);
    return {
      passed: Boolean(obj.passed),
      actual: String(obj.actual ?? ""),
      evidence: String(obj.evidence ?? ""),
    };
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]);
        return {
          passed: Boolean(obj.passed),
          actual: String(obj.actual ?? ""),
          evidence: String(obj.evidence ?? ""),
        };
      } catch {
        // Fall through
      }
    }
  }

  const lc = cleaned.toLowerCase();
  const passed = lc.includes('"passed": true') || lc.includes('"passed":true');
  return {
    passed,
    actual: cleaned.slice(0, 200),
    evidence: "Could not parse structured response",
  };
}
