import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { MemoryManager } from "../memory/manager.js";
import { SiteKnowledge, PageKnowledge } from "../memory/types.js";
import { ModeResult } from "./modes.js";
import { buildSystemPrompt } from "./system-prompt.js";
import * as display from "../cli/display.js";

/**
 * After any command completes, use the AI to analyze the current page
 * and extract learnings into site knowledge.
 */
export async function extractPostCommandLearnings(
  stagehand: Stagehand,
  memory: MemoryManager,
  domain: string,
  instruction: string,
  mode: string,
  result: ModeResult,
  taskId: string,
): Promise<void> {
  if (domain === "unknown" || domain === "about:blank") return;

  let knowledge = await memory.getSiteKnowledge(domain);
  if (!knowledge) {
    knowledge = newSiteKnowledge(domain);
  }

  // Record failed tasks as known issues (only technical errors, not agent output)
  if (!result.success && result.message) {
    const msg = result.message;
    const isTechnicalError =
      msg.includes("Error:") ||
      msg.includes("Timeout") ||
      msg.includes("session was closed") ||
      msg.includes("ECONNREFUSED");
    if (isTechnicalError) {
      const issue = `${mode} command failed with: ${msg.slice(0, 100)}`;
      if (!knowledge.knownIssues.some((i) => i === issue)) {
        knowledge.knownIssues.push(issue);
        if (knowledge.knownIssues.length > 20) {
          knowledge.knownIssues = knowledge.knownIssues.slice(-20);
        }
      }
    }
  }

  // Record page URLs seen during agent actions
  if (result.actions) {
    for (const action of result.actions) {
      const a = action as Record<string, unknown>;
      const pageUrl = a.pageUrl as string | undefined;
      if (pageUrl) {
        addPageIfNew(knowledge, pageUrl);
      }
    }
  }

  // Use AI to analyze the current page and extract structured knowledge
  try {
    const pageAnalysis = await analyzeCurrentPage(stagehand);
    if (pageAnalysis) {
      const currentUrl = stagehand.context.pages()[0]?.url() ?? "";
      mergePageAnalysis(knowledge, currentUrl, pageAnalysis);
    }
  } catch {
    // Best-effort, don't break the flow
  }

  // --- Generate useful learnings from the command result ---

  if (mode === "task" && result.actions && result.actions.length > 0) {
    // Extract navigation shortcuts from the action trail
    const navShortcuts = extractNavShortcuts(result.actions, domain);
    for (const shortcut of navShortcuts) {
      await memory.addLearning({
        domain,
        category: "navigation",
        pattern: shortcut,
        confidence: 0.8,
        source_task_id: taskId,
      });
    }

    if (result.success && instruction.length > 10) {
      // Use AI to generate a concise reusable recipe
      try {
        const recipe = await generateTaskRecipe(
          stagehand,
          instruction,
          result,
        );
        if (recipe) {
          await memory.addLearning({
            domain,
            category: "recipe",
            pattern: recipe,
            confidence: 0.85,
            source_task_id: taskId,
          });
        }
      } catch {
        // Best-effort
      }
    }
  }

  // Store gotcha learnings from failed commands
  if (!result.success && instruction.length > 10 && mode === "task") {
    const reason = result.message?.slice(0, 100) ?? "unknown reason";
    await memory.addLearning({
      domain,
      category: "gotcha",
      pattern: `"${instruction.slice(0, 60)}" failed: ${reason}`,
      confidence: 0.6,
      source_task_id: taskId,
    });
  }

  await memory.saveSiteKnowledge(knowledge);
}

/**
 * Deep learning mode: systematically explore and map the current website.
 * Uses the CUA agent to crawl pages, discover navigation, forms, and flows.
 */
export async function runLearn(
  stagehand: Stagehand,
  config: AppConfig,
  memory: MemoryManager,
  instruction: string,
): Promise<ModeResult> {
  const page = stagehand.context.pages()[0];
  const currentUrl = page.url();
  let domain: string;
  try {
    domain = new URL(currentUrl).hostname;
  } catch {
    return {
      message: "Navigate to a website first before learning it.",
      success: false,
    };
  }

  if (domain === "about:blank" || !domain) {
    return {
      message: "Navigate to a website first before learning it.",
      success: false,
    };
  }

  let knowledge = await memory.getSiteKnowledge(domain);
  if (!knowledge) {
    knowledge = newSiteKnowledge(domain);
  }

  const learnings = await memory.getLearnings(domain);
  const existingKnowledgeSummary = summarizeKnowledge(knowledge);

  display.info("Phase 1: Analyzing current page...");

  // Phase 1: Deep analysis of the current page
  const pageAnalysis = await analyzeCurrentPage(stagehand);
  if (pageAnalysis) {
    mergePageAnalysis(knowledge, currentUrl, pageAnalysis);
  }
  await memory.saveSiteKnowledge(knowledge);

  display.info("Phase 2: Discovering site structure...");

  // Phase 2: Use CUA agent to explore the site and map its structure
  const isFocused = instruction.length > 0;

  const learnSystemPrompt = buildSystemPrompt(knowledge, learnings, { skipBasePrompt: true }) +
    `\n\nSPECIAL MODE: LEARNING
You are a QA tester in learning mode.
IMPORTANT: When reporting what you find, use placeholders instead of actual live values.
Examples: <user_name> instead of real names, <email> instead of real emails, <balance> instead of dollar amounts, <date> instead of specific dates, <count> instead of specific numbers.
Still describe WHAT each page displays and its structure, just not the live data values.
Do NOT submit any forms, create accounts, or make destructive changes — just observe and navigate.

After exploring, provide a DETAILED summary organized EXACTLY as:
**SITE OVERVIEW:**
What this site is and does (2-3 sentences)

**PAGES FOUND:**
For each page: \`/path\`: Page Title - detailed description of what the page contains and does

**FORMS FOUND:**
For each page with forms: \`/path\`: list EVERY input field with its label, type (text/dropdown/checkbox/toggle/etc.), and any placeholder text. List the submit/action buttons.

**NAVIGATION:**
All navigation elements: main nav, sidebar, user menu, breadcrumbs, tabs within pages

**KEY FLOWS:**
Important user journeys through the application

**TIPS:**
QA-relevant observations: loading times, animations, dynamic content, tooltips, potential edge cases`;

  let exploreInstruction: string;
  let exploreMaxSteps: number;

  if (isFocused) {
    exploreInstruction =
      `Navigate DIRECTLY to: ${instruction}\n` +
      `Follow the path step by step. At each step, catalog every UI element you see: buttons, inputs, dropdowns, toggles, tabs, tables.\n` +
      `Do NOT visit other pages. Stay focused on this specific area. Report everything you find in detail.`;
    exploreMaxSteps = 25;
  } else {
    exploreInstruction =
      "Explore and learn about this website thoroughly. " +
      "Navigate through the main sections of the site. Visit at least 5-10 different pages/views. " +
      "On each page, catalog: every navigation link, button, input field, dropdown, toggle, tab, table column, card, icon with an action. " +
      "Click through ALL navigation to discover ALL pages, including subpages, modals, and hidden menus. " +
      "Open dropdown menus, click tabs, expand accordions. " +
      (existingKnowledgeSummary
        ? `What I already know:\n${existingKnowledgeSummary}\nFocus on discovering things NOT in the list above. `
        : "") +
      "Just observe and report everything you find.";
    exploreMaxSteps = 40;
  }

  const agent = stagehand.agent({
    mode: "cua",
    model: {
      modelName: config.cuaModel,
      apiKey: config.apiKey,
    },
    systemPrompt: learnSystemPrompt,
  });

  const exploreResult = await agent.execute({
    instruction: exploreInstruction,
    maxSteps: exploreMaxSteps,
    highlightCursor: true,
  });

  display.info("Phase 3: Extracting structured knowledge...");

  // Phase 3: Extract structured insights from the exploration
  const structuredKnowledge = await stagehand.extract(
    `Based on what you've seen on this website, extract the following information as structured data:
1. A one-sentence description of what this website is
2. The technology stack if observable (React, Angular, etc.)
3. The authentication method (Google SSO, email/password, etc.)
4. A list of all page URLs and paths you've seen or can see in the navigation
5. Any tips for interacting with this site efficiently`,
  );

  // Phase 4: Merge the exploration results into knowledge
  if (typeof structuredKnowledge === "object" && structuredKnowledge !== null) {
    const sk = structuredKnowledge as Record<string, unknown>;
    if (typeof sk.description === "string" || typeof sk.siteDescription === "string") {
      knowledge.siteDescription = (sk.description ?? sk.siteDescription) as string;
    }
    if (Array.isArray(sk.techStack) || Array.isArray(sk.technology)) {
      knowledge.techStack = ((sk.techStack ?? sk.technology) as string[]).map(String);
    }
    if (typeof sk.authMethod === "string" || typeof sk.authentication === "string") {
      knowledge.authMethod = (sk.authMethod ?? sk.authentication) as string;
    }
  }

  // Parse the CUA agent's structured exploration message
  if (exploreResult.message) {
    parseExplorationMessage(exploreResult.message, knowledge, domain);
  }

  // Record page URLs from the agent's actions
  if (exploreResult.actions) {
    for (const action of exploreResult.actions) {
      const a = action as Record<string, unknown>;
      const pageUrl = a.pageUrl as string | undefined;
      if (pageUrl) {
        addPageIfNew(knowledge, pageUrl);
      }
    }
  }

  // Phase 5: Deep per-page analysis (skip for focused learns)
  const pageUrls = Object.keys(knowledge.pages).filter(
    (u) => u.startsWith("http") && !u.includes("about:blank"),
  );
  if (pageUrls.length > 0 && !isFocused) {
    display.info(
      `Phase 5: Deep-scanning ${pageUrls.length} pages for UI details...`,
    );
    const browserPage = stagehand.context.pages()[0];
    for (let i = 0; i < pageUrls.length; i++) {
      const pageUrl = pageUrls[i];
      const pagePath =
        knowledge.pages[pageUrl]?.path ?? new URL(pageUrl).pathname;
      display.info(
        `  [${i + 1}/${pageUrls.length}] Scanning ${pagePath}...`,
      );
      try {
        await browserPage.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeoutMs: 15000,
        });
        await browserPage.waitForTimeout(2000);
        const deepAnalysis = await analyzeCurrentPage(stagehand);
        if (deepAnalysis) {
          mergePageAnalysis(knowledge, pageUrl, deepAnalysis);
        }
      } catch {
        display.warn(`  Skipped ${pagePath} (navigation failed)`);
      }
      await memory.saveSiteKnowledge(knowledge);
    }
  }

  // Save navigation learnings from the learn crawl
  const learnTaskId = "learn-" + Date.now().toString(36);
  const discoveredPaths = knowledge.siteMap.slice(0, 15).join(", ");
  await memory.addLearning({
    domain,
    category: "navigation",
    pattern: `Site has these pages: ${discoveredPaths}`,
    confidence: 0.9,
    source_task_id: learnTaskId,
  });

  if (knowledge.commonFlows.length > 0) {
    await memory.addLearning({
      domain,
      category: "general",
      pattern: `Key user flows: ${knowledge.commonFlows.slice(0, 5).join("; ")}`,
      confidence: 0.85,
      source_task_id: learnTaskId,
    });
  }

  await memory.saveSiteKnowledge(knowledge);

  const summary = [
    `Learned about ${domain}:`,
    knowledge.siteDescription ? `  Site: ${knowledge.siteDescription}` : null,
    knowledge.authMethod ? `  Auth: ${knowledge.authMethod}` : null,
    knowledge.techStack?.length ? `  Tech: ${knowledge.techStack.join(", ")}` : null,
    `  Pages discovered: ${Object.keys(knowledge.pages).length}`,
    `  Site map entries: ${knowledge.siteMap.length}`,
    `  Common flows: ${knowledge.commonFlows.length}`,
    `  Tips: ${knowledge.tips.length}`,
    `  Known issues: ${knowledge.knownIssues.length}`,
    "",
    exploreResult.message ?? "Exploration complete.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message: summary,
    usage: exploreResult.usage as ModeResult["usage"],
    actions: exploreResult.actions,
    success: true,
  };
}

/**
 * Extract learnings from a completed test step.
 * Captures gotchas from failures, timing observations, and UI interaction patterns.
 */
export async function extractTestStepLearning(
  memory: MemoryManager,
  domain: string,
  taskId: string,
  step: { action: string; expected: string; setup?: boolean },
  verdict: "pass" | "fail" | "skip",
  actual: string,
  durationMs: number,
): Promise<void> {
  if (domain === "unknown" || domain === "about:blank" || verdict === "skip") return;

  // Failed steps produce the most valuable learnings
  if (verdict === "fail") {
    const pattern = step.setup
      ? `Setup step "${step.action.slice(0, 80)}" failed: ${actual.slice(0, 120)}`
      : `Assertion "${step.action.slice(0, 80)}" failed — expected "${step.expected.slice(0, 80)}" but got: ${actual.slice(0, 120)}`;

    await memory.addLearning({
      domain,
      category: "gotcha",
      pattern,
      confidence: 0.75,
      source_task_id: taskId,
    });
  }

  // Slow steps produce timing observations
  if (verdict === "pass" && durationMs > 8000) {
    await memory.addLearning({
      domain,
      category: "general",
      pattern: `"${step.action.slice(0, 80)}" takes ~${Math.round(durationMs / 1000)}s — allow extra wait time`,
      confidence: 0.7,
      source_task_id: taskId,
    });
  }
}

/**
 * After a full test run, distill high-level learnings from the results.
 */
export async function extractTestRunLearnings(
  stagehand: Stagehand,
  memory: MemoryManager,
  domain: string,
  testTitle: string,
  steps: Array<{
    step: { action: string; expected: string; setup?: boolean };
    verdict: "pass" | "fail" | "skip";
    actual: string;
    durationMs: number;
  }>,
  overallVerdict: string,
  taskId: string,
): Promise<void> {
  if (domain === "unknown" || domain === "about:blank") return;

  const failedSteps = steps.filter((s) => s.verdict === "fail");
  const passedSteps = steps.filter((s) => s.verdict === "pass");

  // Record a recipe if the test passed fully
  if (overallVerdict === "pass" && passedSteps.length > 1) {
    const stepSummary = passedSteps
      .map((s) => s.step.action.slice(0, 60))
      .join(" -> ");
    await memory.addLearning({
      domain,
      category: "recipe",
      pattern: `Test "${testTitle.slice(0, 60)}": ${stepSummary}`,
      confidence: 0.85,
      source_task_id: taskId,
    });
  }

  // Distill failure patterns into a single gotcha if multiple steps failed
  if (failedSteps.length > 1) {
    const failSummary = failedSteps
      .map((s) => `"${s.step.action.slice(0, 40)}": ${s.actual.slice(0, 60)}`)
      .join("; ");
    await memory.addLearning({
      domain,
      category: "gotcha",
      pattern: `Test "${testTitle.slice(0, 40)}" had ${failedSteps.length} failures: ${failSummary.slice(0, 300)}`,
      confidence: 0.8,
      source_task_id: taskId,
    });
  }

  // Use AI to generate a concise test-specific learning if we have a mixed result
  if (overallVerdict !== "pass" && failedSteps.length > 0) {
    try {
      const context = failedSteps
        .map((s) => `Step: "${s.step.action}" | Expected: "${s.step.expected}" | Got: "${s.actual}"`)
        .join("\n");

      const extracted: unknown = await stagehand.extract(
        `A QA test "${testTitle}" just ran on this website with verdict: ${overallVerdict}.\n` +
        `Failed steps:\n${context}\n\n` +
        `Generate ONE short, reusable tip (1 sentence) that would help future tests avoid the same issue.\n` +
        `Focus on UI behavior, timing, or interaction patterns — not the specific test data.\n` +
        `Return ONLY the tip string.`,
      );

      if (typeof extracted === "string" && extracted.length > 15) {
        await memory.addLearning({
          domain,
          category: "general",
          pattern: extracted.slice(0, 200),
          confidence: 0.7,
          source_task_id: taskId,
        });
      } else if (typeof extracted === "object" && extracted !== null) {
        const val = Object.values(extracted as Record<string, unknown>)[0];
        if (typeof val === "string" && val.length > 15) {
          await memory.addLearning({
            domain,
            category: "general",
            pattern: val.slice(0, 200),
            confidence: 0.7,
            source_task_id: taskId,
          });
        }
      }
    } catch {
      // Best-effort
    }
  }

  // Note: site knowledge page analysis for the final page state is handled
  // by extractPostCommandLearnings (called by the orchestrator after every
  // command, including tests) — no need to duplicate it here.
}

// --- Exploration message parser ---

function extractSection(msg: string, heading: RegExp): string | null {
  const match = msg.match(heading);
  if (!match) return null;
  const start = match.index! + match[0].length;
  const rest = msg.slice(start);
  const nextHeading = rest.match(/\n\*\*[A-Z][A-Z ]+[A-Z]:?\*\*/);
  const end = nextHeading?.index ?? rest.length;
  return rest.slice(0, end).trim();
}

function parseListItems(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 5 && !l.match(/^\*+$/));
}

function parseExplorationMessage(
  msg: string,
  knowledge: SiteKnowledge,
  domain: string,
): void {
  // SITE OVERVIEW
  const overview = extractSection(msg, /\*\*SITE OVERVIEW:?\*\*/i);
  if (overview && !knowledge.siteDescription) {
    const firstSentence = overview.split(/\.\s/)[0];
    if (firstSentence.length > 10) {
      knowledge.siteDescription = firstSentence.trim() + ".";
    }
  }

  // PAGES FOUND -- lines like: `- `/path`: Description - Details`
  const pagesSection = extractSection(msg, /\*\*PAGES FOUND:?\*\*/i);
  if (pagesSection) {
    const pageLines = parseListItems(pagesSection);
    for (const line of pageLines) {
      const m = line.match(/`?(\/[^`:\s]*)`?\s*(?::|-|–)\s*(.+)/);
      if (!m) continue;
      const pagePath = m[1];
      const description = m[2].replace(/\s*[-–]\s*$/, "").trim();
      const titleMatch = description.match(/^([^-–]+?)(?:\s*[-–]\s*(.+))?$/);
      const title = titleMatch?.[1]?.trim() ?? "";
      const desc = titleMatch?.[2]?.trim() ?? description;

      const fullUrl = `https://${domain}${pagePath}`;
      const existing = knowledge.pages[fullUrl] ?? { url: fullUrl, path: pagePath };
      knowledge.pages[fullUrl] = {
        ...existing,
        url: fullUrl,
        path: pagePath,
        title: title || existing.title,
        description: desc || existing.description,
        lastVisited: new Date().toISOString(),
      };

      if (!knowledge.siteMap.includes(pagePath)) {
        knowledge.siteMap.push(pagePath);
      }
    }
    knowledge.siteMap.sort();
  }

  // FORMS FOUND -- lines like: `- `/path`: "field1", "field2" input, "button"`
  const formsSection = extractSection(msg, /\*\*FORMS FOUND:?\*\*/i);
  if (formsSection) {
    const formLines = parseListItems(formsSection);
    for (const line of formLines) {
      const m = line.match(/`?(\/[^`:\s]*)`?\s*(?::|-|–)\s*(.+)/);
      if (!m) continue;
      const pagePath = m[1];
      const fieldsText = m[2];
      const fullUrl = `https://${domain}${pagePath}`;
      const page = knowledge.pages[fullUrl];
      if (!page) continue;

      const fields = fieldsText
        .split(/,\s*/)
        .map((f) => f.replace(/["']/g, "").trim())
        .filter((f) => f.length > 0);

      if (fields.length > 0) {
        page.forms = [{ fields }];
      }
    }
  }

  // NAVIGATION
  const navSection = extractSection(msg, /\*\*NAVIGATION:?\*\*/i);
  if (navSection) {
    const navItems = parseListItems(navSection);
    for (const item of navItems) {
      const existing = knowledge.pages[`https://${domain}/`];
      if (existing) {
        if (!existing.navigation) existing.navigation = [];
        if (!existing.navigation.includes(item)) {
          existing.navigation.push(item);
        }
      }
    }
  }

  // KEY FLOWS
  const flowsSection = extractSection(msg, /\*\*(?:KEY )?FLOWS:?\*\*/i);
  if (flowsSection) {
    const flows = parseListItems(flowsSection);
    knowledge.commonFlows = [];
    for (const flow of flows) {
      if (!flow.startsWith("*") && !knowledge.commonFlows.includes(flow)) {
        knowledge.commonFlows.push(flow);
      }
    }
  }

  // TIPS
  const tipsSection = extractSection(msg, /\*\*TIPS:?\*\*/i);
  if (tipsSection) {
    const tips = parseListItems(tipsSection);
    knowledge.tips = [];
    for (const tip of tips) {
      if (!tip.startsWith("*") && !knowledge.tips.includes(tip)) {
        knowledge.tips.push(tip);
      }
    }
  }
}

// --- Learning extraction helpers ---

function extractNavShortcuts(
  actions: unknown[],
  domain: string,
): string[] {
  const shortcuts: string[] = [];
  let prevPath = "";

  for (const action of actions) {
    const a = action as Record<string, unknown>;
    const pageUrl = a.pageUrl as string | undefined;
    if (!pageUrl) continue;

    let currentPath: string;
    try {
      const u = new URL(pageUrl);
      if (u.hostname !== domain) continue;
      currentPath = u.pathname;
    } catch {
      continue;
    }

    if (currentPath !== prevPath && prevPath) {
      shortcuts.push(`From ${prevPath} navigated to ${currentPath}`);
    }
    prevPath = currentPath;
  }

  // Deduplicate and only keep unique transitions
  const unique = [...new Set(shortcuts)];
  // Collapse into a single path summary if there are many transitions
  if (unique.length > 3) {
    const allPaths = [
      ...new Set(
        actions
          .map((a) => {
            try {
              return new URL((a as Record<string, unknown>).pageUrl as string)
                .pathname;
            } catch {
              return null;
            }
          })
          .filter(Boolean) as string[],
      ),
    ];
    return [
      `Navigation path for this task: ${allPaths.join(" -> ")}`,
    ];
  }
  return unique;
}

async function generateTaskRecipe(
  stagehand: Stagehand,
  instruction: string,
  result: ModeResult,
): Promise<string | null> {
  const pageTrail: string[] = [];
  if (result.actions) {
    for (const action of result.actions) {
      const a = action as Record<string, unknown>;
      const pageUrl = a.pageUrl as string | undefined;
      if (pageUrl) {
        try {
          const p = new URL(pageUrl).pathname;
          if (pageTrail[pageTrail.length - 1] !== p) {
            pageTrail.push(p);
          }
        } catch {
          // skip
        }
      }
    }
  }

  const trailContext = pageTrail.length > 0
    ? `Pages visited in order: ${pageTrail.join(" -> ")}`
    : "";

  const extracted: unknown = await stagehand.extract(
    `The task "${instruction}" was just completed successfully on this website.
${trailContext}
The agent's final message was: "${(result.message ?? "").slice(0, 200)}"

Summarize the steps taken into a SHORT, reusable recipe (1-2 sentences) that someone could follow to repeat this task.
Format: "To <goal>: <step1> -> <step2> -> <step3>"
Use generic terms, not specific user data. Example: "To change user risk: user menu -> Admin -> Edit on user row -> change Risk % -> Save"
Return ONLY the recipe string, nothing else.`,
  );

  if (typeof extracted === "string" && extracted.length > 15) {
    return extracted.slice(0, 200);
  }
  if (typeof extracted === "object" && extracted !== null) {
    const val = Object.values(extracted as Record<string, unknown>)[0];
    if (typeof val === "string" && val.length > 15) {
      return val.slice(0, 200);
    }
  }
  return null;
}

// --- Helpers ---

async function analyzeCurrentPage(
  stagehand: Stagehand,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await stagehand.extract(
      `You are a QA tester cataloging every UI element on this page.
IMPORTANT: When describing data shown on the page, use placeholders instead of actual values.
Examples: instead of "Miguel Santos" write <user_name>, instead of "$12,345" write <balance>, instead of "miguel@email.com" write <email>, instead of "Feb 21, 2026" write <date>, instead of "3 users" write <count>.
Still describe WHAT is displayed (e.g. "displays <user_name> and <balance>"), just not the live values.

Extract ALL of the following in detail:

1. "title": the page title or heading
2. "description": what this page is for (1-2 sentences)
3. "pageType": type of page (login, dashboard, settings, listing, detail, form, landing, table, chart, etc.)
4. "forms": array of ALL forms/input groups on the page. For EACH form:
   - "name": form name or purpose (e.g. "Login form", "Search filter", "Settings form")
   - "fields": array of EVERY input/control in the form. For each field include:
     - label or placeholder text
     - type (text input, password, email, dropdown/select, checkbox, radio, toggle, textarea, date picker, number, file upload)
     - current value if visible
     - whether it appears required
   - "submitButton": the text of the submit/save/action button
   - "notes": any validation messages, help text, or special behavior
5. "navigation": array of ALL navigation elements visible:
   - main nav links (text + where they go)
   - sidebar links
   - breadcrumbs
   - tabs
   - pagination
6. "interactiveElements": array of ALL other interactive elements NOT in forms:
   - buttons (with their text and apparent purpose)
   - dropdowns/menus
   - toggles/switches
   - modals/dialog triggers
   - expandable sections/accordions
   - sortable table headers
   - icons with actions (edit, delete, settings gear, etc.)
   - links within content
7. "dataDisplayed": what data/content is shown on the page:
   - tables (column names)
   - charts/graphs (what they show)
   - cards/lists (what info each card contains)
   - statistics/metrics displayed
8. "notes": any QA-relevant observations:
   - loading spinners or skeleton screens
   - error messages visible
   - empty states
   - tooltips
   - accessibility issues (missing labels, low contrast)
   - responsive behavior hints`,
    );
    if (typeof result === "object" && result !== null) {
      return result as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function mergePageAnalysis(
  knowledge: SiteKnowledge,
  url: string,
  analysis: Record<string, unknown>,
): void {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }

  const existing = knowledge.pages[url] ?? { url, path };
  const page: PageKnowledge = {
    ...existing,
    url,
    path,
    title: (analysis.title as string) ?? existing.title,
    description: (analysis.description as string) ?? existing.description,
    pageType: (analysis.pageType as string) ?? existing.pageType,
    lastVisited: new Date().toISOString(),
  };

  if (Array.isArray(analysis.forms)) {
    page.forms = analysis.forms.map((f: Record<string, unknown>) => ({
      name: f.name as string | undefined,
      fields: Array.isArray(f.fields) ? f.fields.map(String) : [],
      submitButton: f.submitButton as string | undefined,
      notes: f.notes as string | undefined,
    }));
  }

  if (Array.isArray(analysis.navigation)) {
    page.navigation = analysis.navigation.map(String);
  }

  if (Array.isArray(analysis.interactiveElements)) {
    page.interactiveElements = analysis.interactiveElements.map(String);
  }

  if (Array.isArray(analysis.dataDisplayed)) {
    page.dataDisplayed = analysis.dataDisplayed.map(String);
  }

  if (Array.isArray(analysis.notes)) {
    page.notes = analysis.notes.map(String);
  } else if (typeof analysis.notes === "string" && analysis.notes) {
    page.notes = [analysis.notes];
  }

  knowledge.pages[url] = page;

  // Add to site map if not present
  if (!knowledge.siteMap.includes(path)) {
    knowledge.siteMap.push(path);
    knowledge.siteMap.sort();
  }
}

function addPageIfNew(knowledge: SiteKnowledge, url: string): void {
  if (knowledge.pages[url]) return;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  knowledge.pages[url] = { url, path };
  if (!knowledge.siteMap.includes(path)) {
    knowledge.siteMap.push(path);
  }
}

function newSiteKnowledge(domain: string): SiteKnowledge {
  return {
    domain,
    lastUpdated: new Date().toISOString(),
    pages: {},
    siteMap: [],
    commonFlows: [],
    knownIssues: [],
    tips: [],
  };
}

function summarizeKnowledge(knowledge: SiteKnowledge): string {
  const parts: string[] = [];
  if (knowledge.siteDescription) parts.push(`Site: ${knowledge.siteDescription}`);
  if (knowledge.siteMap.length > 0) parts.push(`Known paths: ${knowledge.siteMap.join(", ")}`);
  if (knowledge.commonFlows.length > 0) parts.push(`Known flows: ${knowledge.commonFlows.join("; ")}`);
  if (knowledge.tips.length > 0) parts.push(`Tips: ${knowledge.tips.join("; ")}`);
  return parts.join("\n");
}
