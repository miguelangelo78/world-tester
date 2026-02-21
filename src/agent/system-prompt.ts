import { Learning, SiteKnowledge } from "../memory/types.js";

const BASE_PROMPT = `You are a browser agent whose ONLY job is to accomplish the user's goal.
Today's date is ${new Date().toISOString().split("T")[0]}.
CRITICAL RULES:
- Your task is given as the "instruction". Execute it directly and precisely.
- Do NOT invent, guess, or substitute a different goal. The instruction IS your task.
- Do NOT explore, test, or navigate to pages unrelated to the instruction.
- The site knowledge below is reference material to help you find things faster — it is NOT a list of tasks to do.
- ONLY use the search tool if you're stuck or the task is impossible within the current page.
- Avoid requesting user input. Start working on the instruction immediately.

MODAL & OVERLAY INTERACTION TIPS:
- Do NOT add unnecessary waits after modals open. Click the target element immediately — the system handles retries if the click doesn't register.
- If a click on a tab/button inside a modal doesn't work on the first try:
  1. Click the TEXT label itself, slightly LEFT of center.
  2. If it still doesn't work after 2 attempts, STOP trying and report the failure — the system will retry using alternative DOM methods automatically.
- Do NOT waste steps on repeated clicking or keyboard workarounds. Report the failure early.
- After clicking, verify the content actually changed before proceeding.
- IMPORTANT: If a click fails, always mention the EXACT TEXT of the element in quotes (e.g., 'I tried to click "Risk Settings" tab but it did not respond').`;

export function buildSystemPrompt(
  siteKnowledge: SiteKnowledge | null,
  learnings: Learning[],
  options?: { skipBasePrompt?: boolean },
): string {
  const parts: string[] = [];

  if (!options?.skipBasePrompt) {
    parts.push(BASE_PROMPT);
  }

  if (siteKnowledge) {
    parts.push(buildSiteSection(siteKnowledge));
  }

  if (learnings.length > 0) {
    parts.push(buildLearningsSection(learnings));
  }

  return parts.join("\n\n");
}

function buildSiteSection(k: SiteKnowledge): string {
  const lines: string[] = [
    `--- REFERENCE DATA (not tasks) for ${k.domain} ---`,
  ];

  if (k.siteDescription) {
    lines.push(`Description: ${k.siteDescription}`);
  }
  if (k.authMethod) {
    lines.push(`Authentication: ${k.authMethod}`);
  }

  const pages = Object.values(k.pages);
  if (pages.length > 0) {
    lines.push(`\nPages (${pages.length}):`);
    for (const page of pages.slice(0, 20)) {
      const title = page.title ? ` — ${page.title}` : "";
      const desc = page.description
        ? `: ${page.description.slice(0, 80)}`
        : "";
      lines.push(`  ${page.path}${title}${desc}`);
    }
  }

  // Navigation shortcuts
  const rootPage = k.pages[`https://${k.domain}/`];
  if (rootPage?.navigation?.length) {
    lines.push(`\nNavigation structure:`);
    for (const nav of rootPage.navigation.slice(0, 10)) {
      lines.push(`  - ${nav}`);
    }
  }

  if (k.commonFlows?.length) {
    lines.push(`\nFlows: ${k.commonFlows.slice(0, 5).join("; ")}`);
  }

  if (k.tips?.length) {
    lines.push(`\nTips: ${k.tips.slice(0, 3).join("; ")}`);
  }

  return lines.join("\n");
}

function isUsefulLearning(l: Learning): boolean {
  const p = l.pattern;
  // Filter out raw failure logs — they confuse the CUA into thinking they're tasks
  if (/^"[^"]+"\s+failed:/.test(p)) return false;
  // Filter out generic "completed successfully" entries
  if (/completed successfully via/.test(p)) return false;
  // Filter out "Site exploration completed" noise
  if (/^Site exploration completed/.test(p)) return false;
  return true;
}

function buildLearningsSection(learnings: Learning[]): string {
  const useful = learnings.filter(isUsefulLearning);
  const sorted = [...useful].sort((a, b) => b.confidence - a.confidence);

  const groups: Record<string, Learning[]> = {
    recipe: [],
    navigation: [],
    gotcha: [],
    general: [],
  };
  for (const l of sorted) {
    const cat = l.category ?? "general";
    (groups[cat] ??= []).push(l);
  }

  const lines: string[] = [
    "--- LEARNINGS (reference only, not tasks) ---",
  ];

  if (groups.recipe.length > 0) {
    lines.push("  Task recipes (follow these steps to repeat tasks):");
    for (const l of groups.recipe.slice(0, 10)) {
      lines.push(`    - ${l.pattern}`);
    }
  }

  if (groups.navigation.length > 0) {
    lines.push("  Navigation shortcuts:");
    for (const l of groups.navigation.slice(0, 10)) {
      lines.push(`    - ${l.pattern}`);
    }
  }

  if (groups.gotcha.length > 0) {
    lines.push("  Gotchas (avoid these mistakes):");
    for (const l of groups.gotcha.slice(0, 8)) {
      lines.push(`    - ${l.pattern}`);
    }
  }

  if (groups.general.length > 0) {
    lines.push("  General:");
    for (const l of groups.general.slice(0, 5)) {
      lines.push(`    - ${l.pattern}`);
    }
  }

  return lines.join("\n");
}
