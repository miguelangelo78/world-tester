import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { loadConfig } from "./config/index.js";
import { setupDatabase } from "./db.js";
import { BrowserPool } from "./browser/pool.js";
import { setPool } from "./browser/stagehand.js";
import { getCurrentUrl, getDomain } from "./browser/stagehand.js";
import { CostTracker } from "./cost/tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { Orchestrator } from "./agent/orchestrator.js";
import { parseCommand, parseBrowserCommand, getHelpText } from "./cli/parser.js";
import { injectSessionContext } from "./agent/chat.js";
import * as display from "./cli/display.js";

async function main() {
  display.banner();

  const config = loadConfig();
  display.info(`Provider: ${config.provider} | Model: ${config.cuaModel}`);
  display.info(`Headless: ${config.headless}`);

  display.info("Connecting to database...");
  await setupDatabase();
  display.success("Database ready");

  const memory = new MemoryManager(config.dataDir);
  await memory.init();
  display.success("Memory system initialized");

  const costTracker = new CostTracker(config.cuaModel, config.dataDir);
  await costTracker.init();

  // Initialize browser pool and spawn the default "main" browser
  display.info("Launching browser...");
  const pool = new BrowserPool(config, costTracker);
  setPool(pool);
  const mainBrowser = await pool.spawn("main");
  display.success("Browser ready");

  if (config.targetUrl) {
    const page = mainBrowser.activeTab();
    await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
    display.info(`Navigated to: ${config.targetUrl}`);
  }

  const orchestrator = new Orchestrator(pool, config, costTracker, memory);

  const previousEntries = await memory.loadPreviousSession();
  injectSessionContext(previousEntries);

  display.separator();
  console.log(getHelpText());
  display.separator();

  const rl = readline.createInterface({ input, output });

  const prompt = () => {
    const url = getCurrentUrl();
    const short = url.length > 50 ? url.slice(0, 47) + "..." : url;
    const browserLabel = pool.size() > 1
      ? `${pool.activeLabel()}|`
      : "";
    const tabCount = pool.active().tabs().length;
    const tabLabel = tabCount > 1 ? ` (${tabCount} tabs)` : "";
    return `\n[${browserLabel}${short}${tabLabel}]\n> `;
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

    // ── Browser/tab management commands ──
    const browserCmd = parseBrowserCommand(trimmed);
    if (browserCmd) {
      try {
        switch (browserCmd.type) {
          case "browser_list":
            console.log(pool.formatList());
            break;

          case "browser_spawn": {
            display.info(`Spawning browser "${browserCmd.name}"...`);
            await pool.spawn(browserCmd.name, {
              profile: browserCmd.isolated ? "isolated" : "shared",
              startUrl: config.targetUrl,
            });
            display.success(`Browser "${browserCmd.name}" ready`);
            break;
          }

          case "browser_kill":
            await pool.despawn(browserCmd.name);
            display.success(`Browser "${browserCmd.name}" closed`);
            break;

          case "browser_switch":
            pool.setActive(browserCmd.name);
            display.success(`Switched to browser "${browserCmd.name}"`);
            break;

          case "tab_list": {
            const tabs = pool.active().tabs();
            for (let i = 0; i < tabs.length; i++) {
              const url = tabs[i].url();
              const short = url.length > 60 ? url.slice(0, 57) + "..." : url;
              console.log(`  [${i}] ${short}`);
            }
            break;
          }

          case "tab_new": {
            const page = await pool.active().newTab(browserCmd.url);
            const idx = pool.active().tabs().indexOf(page);
            display.success(`New tab [${idx}] opened${browserCmd.url ? `: ${browserCmd.url}` : ""}`);
            break;
          }

          case "tab_switch": {
            const target = browserCmd.target;
            const asNum = parseInt(target, 10);
            if (!isNaN(asNum)) {
              pool.active().switchTab(asNum);
            } else {
              pool.active().switchTab(target);
            }
            display.success(`Switched to tab: ${pool.active().getUrl()}`);
            break;
          }

          case "tab_close":
            await pool.active().closeTab(browserCmd.index);
            display.success("Tab closed");
            break;
        }
      } catch (err) {
        display.error(err instanceof Error ? err.message : String(err));
      }
      continue;
    }

    // ── Standard commands ──
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
  await pool.closeAll();
  rl.close();
  display.success("Goodbye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
