import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { Learning, SiteKnowledge } from "../memory/types.js";
import { UsageData } from "../cost/tracker.js";

export interface ModeResult {
  message: string;
  usage?: UsageData;
  actions?: unknown[];
  success: boolean;
  streamed?: boolean;
}

export async function runExtract(
  stagehand: Stagehand,
  instruction: string,
): Promise<ModeResult> {
  const result = await stagehand.extract(instruction);
  return {
    message: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    success: true,
  };
}

export async function runAct(
  stagehand: Stagehand,
  instruction: string,
): Promise<ModeResult> {
  const result = await stagehand.act(instruction);
  return {
    message: result.success
      ? `Action completed: ${instruction}`
      : `Action may not have completed: ${instruction}`,
    success: result.success,
  };
}

export async function runObserve(
  stagehand: Stagehand,
  instruction: string,
): Promise<ModeResult> {
  const result = await stagehand.observe(instruction || "What can I interact with on this page?");
  const formatted = result
    .map((item: { description: string }) => `  - ${item.description}`)
    .join("\n");
  return {
    message: `Observable elements:\n${formatted}`,
    success: true,
  };
}

export async function runTask(
  stagehand: Stagehand,
  instruction: string,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
): Promise<ModeResult> {
  const agent = stagehand.agent({
    mode: "cua",
    model: {
      modelName: config.cuaModel,
      apiKey: config.apiKey,
    },
    systemPrompt: buildSystemPrompt(siteKnowledge, learnings),
  });

  const result = await agent.execute({
    instruction,
    maxSteps: 30,
    highlightCursor: true,
  });

  return {
    message: result.message ?? "Task completed.",
    usage: result.usage as UsageData | undefined,
    actions: result.actions,
    success: result.success === true,
  };
}

export async function runGoto(
  stagehand: Stagehand,
  url: string,
): Promise<ModeResult> {
  const page = stagehand.context.pages()[0];
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  return {
    message: `Navigated to: ${url}\nPage title: ${title}`,
    success: true,
  };
}

export async function runSearch(
  stagehand: Stagehand,
  query: string,
  config: AppConfig,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
): Promise<ModeResult> {
  const page = stagehand.context.pages()[0];
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

  const result = await stagehand.extract(
    `Extract the top 5 search results from this Google search page. For each result, get the title, URL, and snippet/description.`,
  );

  return {
    message: `Search results for "${query}":\n${typeof result === "string" ? result : JSON.stringify(result, null, 2)}`,
    success: true,
  };
}

export async function runAsk(
  stagehand: Stagehand,
  question: string,
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
): Promise<ModeResult> {
  let context = "";

  if (siteKnowledge) {
    context += `Site knowledge for ${siteKnowledge.domain}:\n`;
    context += JSON.stringify(siteKnowledge, null, 2) + "\n\n";
  }

  if (learnings.length > 0) {
    context += "Learnings:\n";
    for (const l of learnings) {
      context += `  - [${l.domain}] ${l.pattern}\n`;
    }
  }

  const prompt = context
    ? `Based on what you see on the page and this context:\n${context}\nAnswer: ${question}`
    : question;

  const result = await stagehand.extract(prompt);
  return {
    message: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    success: true,
  };
}
