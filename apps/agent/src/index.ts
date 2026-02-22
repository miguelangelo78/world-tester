import readline from "readline";
import { stdin as input, stdout as output } from "process";
import { getCurrentUrl, getDomain } from "./browser/stagehand.js";
import { parseCommand, parseBrowserCommand, parseConversationCommand, getHelpText } from "./cli/parser.js";
import * as display from "./cli/display.js";
import { createCliSink } from "./cli-sink.js";
import { createAgentCore } from "./core.js";
import { loadConversationContext } from "./agent/chat.js";
import { isAbortError } from "./abort.js";

function question(rl: readline.Interface, promptText: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(promptText, resolve);
  });
}

async function main() {
  display.banner();

  const sink = createCliSink();
  const { config, pool, orchestrator, memory, costTracker, shutdown, switchConversation, createConversation } =
    await createAgentCore(sink);

  display.separator();
  console.log(getHelpText());
  display.separator();

  const rl = readline.createInterface({ input, output });

  let activeAbort: AbortController | null = null;

  rl.on("SIGINT", () => {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
      console.log("\n[aborted]");
      return;
    }
    // No command running — behave like normal Ctrl+C (exit)
    console.log();
    display.info("Shutting down...");
    shutdown().then(() => {
      rl.close();
      display.success("Goodbye!");
      process.exit(0);
    });
  });

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
      line = await question(rl, prompt());
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
            const activeBrowser = pool.active();
            if (!isNaN(asNum)) {
              activeBrowser.switchTab(asNum);
            } else {
              activeBrowser.switchTab(target);
            }
            await activeBrowser.focusActiveTab();
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

    // ── Conversation management commands ──
    const convCmd = parseConversationCommand(trimmed);
    if (convCmd) {
      try {
        switch (convCmd.type) {
          case "conv_list": {
            const convs = await memory.listConversations();
            if (convs.length === 0) {
              display.info("No conversations yet.");
            } else {
              for (const c of convs) {
                const active = c.id === memory.activeConversationId ? " *" : "  ";
                console.log(`${active} ${c.title} (${c.messageCount} msgs) [${c.id.slice(0, 8)}]`);
              }
            }
            break;
          }
          case "conv_new": {
            const { conversation } = await createConversation(convCmd.title);
            display.success(`New conversation: "${conversation.title}"`);
            break;
          }
          case "conv_switch": {
            // Support switching by partial ID or by list index
            const convs = await memory.listConversations();
            let targetId = convCmd.target;
            const asNum = parseInt(convCmd.target, 10);
            if (!isNaN(asNum) && asNum >= 0 && asNum < convs.length) {
              targetId = convs[asNum].id;
            } else {
              const match = convs.find((c) => c.id.startsWith(convCmd.target));
              if (match) targetId = match.id;
            }
            const { conversation, messages } = await switchConversation(targetId);
            display.success(`Switched to: "${conversation.title}" (${messages.length} messages)`);
            break;
          }
          case "conv_rename": {
            await memory.renameConversation(memory.activeConversationId, convCmd.title);
            display.success(`Conversation renamed to: "${convCmd.title}"`);
            break;
          }
          case "conv_archive": {
            const oldId = memory.activeConversationId;
            await memory.archiveConversation(oldId);
            const msgs = await memory.getConversationMessages(memory.activeConversationId);
            loadConversationContext(msgs);
            const conv = await memory.getActiveConversation();
            display.success(`Archived. Now on: "${conv?.title ?? "New Conversation"}"`);
            break;
          }
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
        const ac = new AbortController();
        activeAbort = ac;
        try {
          await orchestrator.execute(command, sink, ac.signal);
        } catch (err) {
          if (isAbortError(err)) {
            display.warn("Command aborted.");
          } else {
            throw err;
          }
        } finally {
          activeAbort = null;
        }
        break;
      }
    }
  }

  display.info("Shutting down...");
  await shutdown();
  rl.close();
  display.success("Goodbye!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
