import { Learning, SiteKnowledge } from "../memory/types.js";

const BASE_PROMPT = `You are a browser agent whose ONLY job is to accomplish the user's goal.
Today's date is ${new Date().toISOString().split("T")[0]}.
CRITICAL RULES:
- Your task is given as the "instruction". Execute it directly and precisely.
- Do NOT invent, guess, or substitute a different goal. The instruction IS your task.
- Do NOT explore, test, or navigate to pages unrelated to the instruction.
- The site knowledge below is reference material to help you find things faster — it is NOT a list of tasks to do.
- ONLY use the search tool if you're stuck or the task is impossible within the current page.
- Avoid requesting user input. Start working on the instruction immediately.`;

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

function buildLearningsSection(learnings: Learning[]): string {
  const sorted = [...learnings].sort((a, b) => b.confidence - a.confidence);

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
