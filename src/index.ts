import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadConfig } from "./config/index.js";
import { initBrowser, closeBrowser, getCurrentUrl, getDomain } from "./browser/stagehand.js";
import { CostTracker } from "./cost/tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { Orchestrator } from "./agent/orchestrator.js";
import { parseCommand, getHelpText } from "./cli/parser.js";
import { injectSessionContext } from "./agent/chat.js";
import * as display from "./cli/display.js";

async function main() {
  display.banner();

  const config = loadConfig();
  display.info(`Provider: ${config.provider} | Model: ${config.cuaModel}`);
  display.info(`Headless: ${config.headless}`);

  // Initialize memory
  const memory = new MemoryManager(config.dataDir);
  await memory.init();
  display.success("Memory system initialized");

  // Initialize cost tracker with persistent billing ledger
  const costTracker = new CostTracker(config.cuaModel, config.dataDir);
  await costTracker.init();

  // Initialize browser with logger hook for token tracking
  display.info("Launching browser...");
  const stagehand = await initBrowser(config, costTracker);
  display.success("Browser ready");

  // Navigate to target URL if set
  if (config.targetUrl) {
    const page = stagehand.context.pages()[0];
    await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
    display.info(`Navigated to: ${config.targetUrl}`);
  }

  // Initialize orchestrator
  const orchestrator = new Orchestrator(stagehand, config, costTracker, memory);

  // Seed chat with previous session context so the agent remembers past interactions
  const previousEntries = await memory.loadPreviousSession();
  injectSessionContext(previousEntries);

  display.separator();
  console.log(getHelpText());
  display.separator();

  // CLI loop
  const rl = readline.createInterface({ input, output });

  const prompt = () => {
    const url = getCurrentUrl();
    const short =
      url.length > 50 ? url.slice(0, 47) + "..." : url;
    return `\n[${short}]\n> `;
  };

  let running = true;

  while (running) {
    let line: string;
    try {
      line = await rl.question(prompt());
    } catch {
      break;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    switch (trimmed.toLowerCase()) {
      case "quit":
      case "exit":
        running = false;
        break;

      case "help":
        console.log(getHelpText());
        break;

      case "cost": {
        const session = costTracker.getSessionTotal();
        const billing = costTracker.getBillingCycleTotal();
        const cycleDate = billing.cycleStart
          ? new Date(billing.cycleStart).toLocaleDateString()
          : "N/A";
        display.info(
          `Session: $${session.costUsd.toFixed(4)} | ` +
          `Tokens: ${session.inputTokens.toLocaleString()} in / ${session.outputTokens.toLocaleString()} out`,
        );
        display.info(
          `Billing cycle (since ${cycleDate}): $${billing.costUsd.toFixed(4)} | ` +
          `Sessions: ${billing.sessionCount} | ` +
          `Tokens: ${billing.inputTokens.toLocaleString()} in / ${billing.outputTokens.toLocaleString()} out`,
        );
        break;
      }

      case "history": {
        const tasks = await memory.getRecentTasks(5);
        if (tasks.length === 0) {
          display.info("No task history yet.");
        } else {
          for (const t of tasks) {
            console.log(
              `  [${t.outcome.toUpperCase()}] ${t.instruction.slice(0, 60)} ($${t.cost_usd.toFixed(4)})`,
            );
          }
        }
        break;
      }

      case "knowledge": {
        const domain = getDomain();
        const siteKnowledge = await memory.getSiteKnowledge(domain);
        const learnings = await memory.getLearnings(domain);

        if (!siteKnowledge && learnings.length === 0) {
          display.info(`No knowledge stored for ${domain}. Use "l:" to learn this site.`);
        } else {
          if (siteKnowledge) {
            display.info(`Site knowledge for ${siteKnowledge.domain}:`);
            if (siteKnowledge.siteDescription) console.log(`  Description: ${siteKnowledge.siteDescription}`);
            if (siteKnowledge.authMethod) console.log(`  Auth: ${siteKnowledge.authMethod}`);
            if (siteKnowledge.techStack?.length) console.log(`  Tech: ${siteKnowledge.techStack.join(", ")}`);
            console.log(`  Pages: ${Object.keys(siteKnowledge.pages).length}`);
            if (siteKnowledge.siteMap.length > 0) {
              console.log(`  Site map: ${siteKnowledge.siteMap.join(", ")}`);
            }
            if (siteKnowledge.commonFlows.length > 0) {
              console.log(`  Flows: ${siteKnowledge.commonFlows.join("; ")}`);
            }
            if (siteKnowledge.tips.length > 0) {
              console.log(`  Tips:`);
              for (const tip of siteKnowledge.tips) console.log(`    - ${tip}`);
            }
            if (siteKnowledge.knownIssues.length > 0) {
              console.log(`  Known issues:`);
              for (const issue of siteKnowledge.knownIssues) console.log(`    - ${issue}`);
            }
          }

          if (learnings.length > 0) {
            display.info(`Learnings (${learnings.length}):`);
            const catLabels: Record<string, string> = {
              recipe: "Recipes",
              navigation: "Navigation",
              gotcha: "Gotchas",
              general: "General",
            };
            const groups: Record<string, typeof learnings> = {};
            for (const l of learnings) {
              const cat = l.category ?? "general";
              (groups[cat] ??= []).push(l);
            }
            for (const [cat, items] of Object.entries(groups)) {
              console.log(`  ${catLabels[cat] ?? cat}:`);
              for (const l of items) {
                const date = l.created ? new Date(l.created).toLocaleDateString() : "?";
                console.log(`    [${(l.confidence * 100).toFixed(0)}%] ${l.pattern}  (${date})`);
              }
            }
          }
        }
        break;
      }

      default: {
        const command = parseCommand(trimmed);
        await orchestrator.execute(command);
        break;
      }
    }
  }

  display.info("Shutting down...");
  await memory.saveSession();
  await closeBrowser();
  rl.close();
  display.success("Goodbye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
