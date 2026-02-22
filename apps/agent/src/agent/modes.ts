import { Stagehand, type StagehandPage } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { Learning, SiteKnowledge } from "../memory/types.js";
import { UsageData } from "../cost/tracker.js";
import type { OutputSink } from "../output-sink.js";
import { raceAbort } from "../abort.js";

export interface ModeResult {
  message: string;
  usage?: UsageData;
  actions?: unknown[];
  success: boolean;
  streamed?: boolean;
}

/**
 * Returns the page Stagehand considers "active" — respects
 * the tab the user selected rather than always returning pages()[0].
 */
function getActivePage(stagehand: Stagehand): StagehandPage {
  const ctx = stagehand.context as any;
  if (typeof ctx.activePage === "function") {
    const ap = ctx.activePage();
    if (ap) return ap;
  }
  return stagehand.context.pages()[0];
}

/**
 * Stagehand's extract() often returns `{ extraction: "..." }` — unwrap
 * single-string wrapper objects so the user sees clean text.
 */
function unwrapExtraction(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const values = Object.values(result as Record<string, unknown>);
    if (values.length === 1 && typeof values[0] === "string") {
      return values[0];
    }
  }
  return JSON.stringify(result, null, 2);
}

export async function runExtract(
  stagehand: Stagehand,
  instruction: string,
): Promise<ModeResult> {
  const result = await stagehand.extract(instruction);
  return {
    message: unwrapExtraction(result),
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
  sink?: OutputSink,
  signal?: AbortSignal,
): Promise<ModeResult> {
  const systemPrompt = buildSystemPrompt(siteKnowledge, learnings);

  const agent = stagehand.agent({
    mode: "cua",
    model: {
      modelName: config.cuaModel,
      apiKey: config.apiKey,
    },
    systemPrompt,
  });

  const result = await raceAbort(agent.execute({
    instruction,
    maxSteps: 30,
    highlightCursor: true,
  }), signal);

  const msg = result.message ?? "Task completed.";
  const ok = result.success === true;
  let allActions: unknown[] = [...(result.actions ?? [])];
  let totalUsage = result.usage as UsageData | undefined;

  // Detect stuck clicks — CUA reports clicking but nothing changed
  if (looksLikeStuckClick(msg)) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const retryResult = await retryWithAct(stagehand, instruction, msg);
    if (retryResult?.success) {
      sink?.info(`[auto-retry] Clicked "${retryResult.retryTarget}" via fallback. Resuming task...`);
      allActions.push(...(retryResult.actions ?? []));
      totalUsage = mergeUsage(totalUsage, retryResult.usage);

      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      // Resume: run a new CUA pass now that the stuck element was clicked
      const resumeAgent = stagehand.agent({
        mode: "cua",
        model: {
          modelName: config.cuaModel,
          apiKey: config.apiKey,
        },
        systemPrompt,
      });

      const resumeInstruction =
        `A previous automated retry just clicked "${retryResult.retryTarget}" successfully. ` +
        `The page should now show the content for that element. ` +
        `Continue with the original task: ${instruction}`;

      const resumeResult = await raceAbort(resumeAgent.execute({
        instruction: resumeInstruction,
        maxSteps: 20,
        highlightCursor: true,
      }), signal);

      const resumeMsg = resumeResult.message ?? "Task resumed and completed.";
      allActions.push(...(resumeResult.actions ?? []));
      totalUsage = mergeUsage(totalUsage, resumeResult.usage as UsageData | undefined);

      return {
        message: `[Auto-retry fixed stuck click on "${retryResult.retryTarget}"]\n${resumeMsg}`,
        usage: totalUsage,
        actions: allActions,
        success: resumeResult.success === true,
      };
    }
  }

  return {
    message: msg,
    usage: totalUsage,
    actions: allActions,
    success: ok,
  };
}

const STUCK_PATTERNS = [
  /tab.*(?:didn't|did not|doesn't|does not|won't|could not|couldn't).*(?:respond|work|change|switch|open)/i,
  /click.*(?:didn't|did not|doesn't|does not).*(?:work|change|anything|respond)/i,
  /(?:still|remains?).*(?:same|selected|unchanged|visible)/i,
  /(?:unable|failed|couldn't|could not).*(?:click|select|activate|switch|open).*(?:tab|button|link)/i,
  /(?:content|page|view).*(?:didn't|did not).*(?:change|update|switch)/i,
  /not (?:easily )?clickable|inaccessible/i,
];

function looksLikeStuckClick(message: string): boolean {
  return STUCK_PATTERNS.some((p) => p.test(message));
}

function extractClickTarget(message: string): string | null {
  const patterns = [
    /["']([^"'\n]{3,50})["']\s*tab/i,
    /(?:click|select|activate|switch to|open)\s+(?:on\s+)?(?:the\s+)?["']([^"'\n]{3,50})["']/i,
    /(?:click|select|activate|switch to|open)\s+(?:on\s+)?(?:the\s+)?(\S+(?:\s+\S+){0,3})\s+(?:tab|button|link)/i,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

interface RetryResult extends ModeResult {
  retryTarget: string;
}

async function retryWithAct(
  stagehand: Stagehand,
  originalInstruction: string,
  cuaMessage: string,
): Promise<RetryResult | null> {
  const target = extractClickTarget(cuaMessage);
  if (!target) return null;

  const page = getActivePage(stagehand);

  // Attempt 1: Playwright locator with text matching + force click
  try {
    const locator = page.locator(
      `[role="tab"]:has-text("${target}"), button:has-text("${target}"), [data-tab]:has-text("${target}"), a:has-text("${target}")`,
    );
    const count = await locator.count();
    if (count > 0) {
      await locator.first().click();
      await page.waitForTimeout(1000);
      return {
        message: `[Retry: locator] Clicked "${target}" via Playwright locator.`,
        success: true,
        actions: [{ type: "locator-retry", target }],
        retryTarget: target,
      };
    }
  } catch {
    // Locator didn't match, continue to next attempt
  }

  // Attempt 2: DOM evaluate — find by text, dispatch full event sequence
  try {
    const clicked = await page.evaluate((txt: string) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        null,
      );
      let node: Element | null = walker.currentNode as Element;
      const candidates: Element[] = [];
      while (node) {
        const text = node.textContent?.trim() ?? "";
        if (
          text.toLowerCase().includes(txt.toLowerCase()) &&
          (node.tagName === "BUTTON" ||
            node.tagName === "A" ||
            node.getAttribute("role") === "tab" ||
            node.getAttribute("data-tab") !== null ||
            node.classList.contains("tab") ||
            node.closest("[role='tablist']"))
        ) {
          candidates.push(node);
        }
        node = walker.nextNode() as Element | null;
      }
      // Prefer the deepest (most specific) match
      candidates.sort((a, b) =>
        (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0),
      );
      const el = candidates[0];
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
      if (el instanceof HTMLElement) el.focus();
      return true;
    }, target);

    if (clicked) {
      await page.waitForTimeout(1000);
      return {
        message: `[Retry: DOM events] Dispatched click events on "${target}" via DOM.`,
        success: true,
        actions: [{ type: "dom-retry", target }],
        retryTarget: target,
      };
    }
  } catch {
    // DOM evaluate failed
  }

  // Attempt 3: Stagehand act() — DOM-selector based click
  try {
    const actResult = await stagehand.act(`Click on "${target}"`);
    if (actResult.success) {
      await page.waitForTimeout(1000);
      return {
        message: `[Retry: act()] Clicked "${target}" via Stagehand act.`,
        success: true,
        actions: [{ type: "act-retry", target }],
        retryTarget: target,
      };
    }
  } catch {
    // act() failed
  }

  // Attempt 4: evaluate to click any element whose text matches, without role filter
  try {
    const clicked = await page.evaluate((txt: string) => {
      const all = document.querySelectorAll("*");
      for (const el of all) {
        if (
          el.children.length === 0 &&
          el.textContent?.trim().toLowerCase() === txt.toLowerCase() &&
          el instanceof HTMLElement
        ) {
          el.click();
          return true;
        }
      }
      return false;
    }, target);
    if (clicked) {
      await page.waitForTimeout(1000);
      return {
        message: `[Retry: direct .click()] Called .click() on exact-text element "${target}".`,
        success: true,
        actions: [{ type: "textclick-retry", target }],
        retryTarget: target,
      };
    }
  } catch {
    // direct click failed
  }

  return null;
}

function mergeUsage(
  a: UsageData | undefined,
  b: UsageData | undefined,
): UsageData | undefined {
  if (!a && !b) return undefined;
  return {
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
  };
}

export async function runGoto(
  stagehand: Stagehand,
  url: string,
): Promise<ModeResult> {
  const page = getActivePage(stagehand);
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
  const page = getActivePage(stagehand);
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
    message: unwrapExtraction(result),
    success: true,
  };
}
