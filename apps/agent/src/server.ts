import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createAgentCore, AgentCore } from "./core.js";
import { isAbortError } from "./abort.js";
import { parseCommand, parseBrowserCommand, getHelpText } from "./cli/parser.js";
import { getCurrentUrl, getDomain } from "./browser/stagehand.js";
import type { OutputSink } from "./output-sink.js";
import type {
  WSMessage,
  CommandResultPayload,
  CostUpdatePayload,
  BrowserStatePayload,
  BrowserInfo,
  LogPayload,
  ScreenshotPayload,
  ConversationListPayload,
  ConversationSwitchedPayload,
  ConversationCurrentPayload,
} from "@world-tester/shared";

const PORT = parseInt(process.env.AGENT_PORT ?? "3100", 10);

function toScreenshotUrl(filePath: string | undefined | null): string | undefined {
  if (!filePath) return undefined;
  const basename = path.basename(filePath);
  return `/screenshots/${encodeURIComponent(basename)}`;
}

import type { MemoryManager } from "./memory/manager.js";
import type { ConversationMessageType } from "@world-tester/shared";

function createWsSink(clients: Set<WebSocket>, commandId?: string, memory?: MemoryManager): OutputSink {
  function broadcast(msg: WSMessage) {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  function persist(type: ConversationMessageType, content: string) {
    memory?.addConversationMessage({
      role: "agent",
      type,
      content,
      commandId,
    });
  }

  let streamAccum = "";

  const sink: OutputSink & { flushStream(): void } = {
    write(text: string) {
      broadcast({ type: "stream_chunk", id: commandId, payload: { text } });
      streamAccum += text;
    },
    flushStream() {
      if (streamAccum) {
        persist("agent", streamAccum.trim());
        streamAccum = "";
      }
    },
    info(msg: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "info", message: msg } satisfies LogPayload });
      persist("info", msg);
    },
    success(msg: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "success", message: msg } satisfies LogPayload });
      persist("success", msg);
    },
    warn(msg: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "warn", message: msg } satisfies LogPayload });
      persist("warn", msg);
    },
    error(msg: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "error", message: msg } satisfies LogPayload });
      persist("error", msg);
    },
    agentMessage(msg: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "agent", message: msg } satisfies LogPayload });
      persist("agent", msg);
    },
    cost(line: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "info", message: line } satisfies LogPayload });
    },
    modeSwitch(from: string, to: string, instruction: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "info", message: `[${from} -> ${to}] ${instruction}` } satisfies LogPayload });
      persist("info", `[${from} -> ${to}] ${instruction}`);
    },
    testStep(index: number, total: number, action: string, status: string) {
      broadcast({
        type: "step_update",
        id: commandId,
        payload: { index, total, action, status },
      });
      persist("step", `[${index}/${total}] ${status.toUpperCase()} ${action}`);
    },
    separator() {},
    log(msg: string) {
      broadcast({ type: "log", id: commandId, payload: { level: "info", message: msg } satisfies LogPayload });
      persist("info", msg);
    },
  };
  return sink;
}

function buildBrowserState(core: AgentCore): BrowserStatePayload {
  const browsers: BrowserInfo[] = core.pool.list().map((b) => ({
    name: b.name,
    isActive: b.name === core.pool.activeLabel(),
    tabs: b.tabs().map((t, i) => ({
      index: i,
      url: t.url(),
    })),
    activeTabIndex: b.activeTabIdx(),
  }));

  return {
    browsers,
    activeUrl: getCurrentUrl(),
  };
}

async function handleCommand(
  raw: string,
  core: AgentCore,
  clients: Set<WebSocket>,
  commandId?: string,
  signal?: AbortSignal,
) {
  const broadcast = (msg: WSMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  };

  const trimmed = raw.trim();
  if (!trimmed) return;

  // Browser/tab management
  const browserCmd = parseBrowserCommand(trimmed);
  if (browserCmd) {
    const sink = createWsSink(clients, commandId);
    let resultMessage = "OK";
    try {
      switch (browserCmd.type) {
        case "browser_list": {
          const state = buildBrowserState(core);
          broadcast({ type: "browser_state", id: commandId, payload: state });
          const lines = state.browsers.map((b) => {
            const marker = b.isActive ? " (active)" : "";
            const tabs = b.tabs.map((t, i) =>
              `  [${i}]${i === b.activeTabIndex ? "*" : " "} ${t.url || "about:blank"}`
            ).join("\n");
            return `${b.name}${marker}\n${tabs}`;
          });
          resultMessage = lines.length > 0 ? lines.join("\n\n") : "No browsers running.";
          sink.log(resultMessage);
          break;
        }
        case "browser_spawn":
          await core.pool.spawn(browserCmd.name, {
            profile: browserCmd.isolated ? "isolated" : "shared",
            startUrl: core.config.targetUrl,
          });
          resultMessage = `Browser "${browserCmd.name}" spawned.`;
          sink.success(resultMessage);
          break;
        case "browser_kill":
          await core.pool.despawn(browserCmd.name);
          resultMessage = `Browser "${browserCmd.name}" closed.`;
          sink.info(resultMessage);
          break;
        case "browser_switch":
          core.pool.setActive(browserCmd.name);
          resultMessage = `Switched to browser "${browserCmd.name}".`;
          sink.success(resultMessage);
          break;
        case "tab_new":
          await core.pool.active().newTab(browserCmd.url);
          resultMessage = `New tab opened${browserCmd.url ? ` at ${browserCmd.url}` : ""}.`;
          sink.success(resultMessage);
          break;
        case "tab_switch": {
          const asNum = parseInt(browserCmd.target, 10);
          const activeBrowser = core.pool.active();
          activeBrowser.switchTab(!isNaN(asNum) ? asNum : browserCmd.target);
          await activeBrowser.focusActiveTab();
          resultMessage = `Switched to tab ${browserCmd.target}.`;
          sink.success(resultMessage);
          break;
        }
        case "tab_close":
          await core.pool.active().closeTab(browserCmd.index);
          resultMessage = `Tab${browserCmd.index !== undefined ? ` ${browserCmd.index}` : ""} closed.`;
          sink.info(resultMessage);
          break;
        case "tab_list": {
          const active = core.pool.active();
          const tabLines = active.tabs().map((t, i) =>
            `  [${i}]${i === active.activeTabIdx() ? "*" : " "} ${t.url() || "about:blank"}`
          );
          resultMessage = tabLines.length > 0 ? tabLines.join("\n") : "No tabs.";
          sink.log(resultMessage);
          break;
        }
      }
    } catch (err) {
      broadcast({
        type: "error",
        id: commandId,
        payload: { message: err instanceof Error ? err.message : String(err) },
      });
      return;
    }
    broadcast({ type: "browser_state", id: commandId, payload: buildBrowserState(core) });
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: resultMessage, success: true, mode: "browser", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  // Info commands
  const lower = trimmed.toLowerCase();
  if (lower === "cost") {
    const session = core.costTracker.getSessionTotal();
    const billing = core.costTracker.getBillingCycleTotal();
    const costSink = createWsSink(clients, commandId);
    costSink.log([
      `Session cost:   $${session.costUsd.toFixed(4)}`,
      `Session tokens: ${session.inputTokens.toLocaleString()} in / ${session.outputTokens.toLocaleString()} out`,
      `Billing cycle:  $${billing.costUsd.toFixed(4)} (${billing.sessionCount} sessions)`,
    ].join("\n"));
    broadcast({
      type: "cost_update",
      id: commandId,
      payload: {
        action: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        session,
        billing: {
          costUsd: billing.costUsd,
          inputTokens: billing.inputTokens,
          outputTokens: billing.outputTokens,
          sessionCount: billing.sessionCount,
          cycleStart: billing.cycleStart,
        },
      } satisfies CostUpdatePayload,
    });
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "cost", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  if (lower === "history") {
    const tasks = await core.memory.getRecentTasks(20);
    const historySink = createWsSink(clients, commandId);
    if (Array.isArray(tasks) && tasks.length > 0) {
      historySink.log(`${tasks.length} recent task(s) loaded.`);
    } else {
      historySink.log("No task history yet.");
    }
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: JSON.stringify(tasks), success: true, mode: "history", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  if (lower === "knowledge") {
    const domain = getDomain();
    const siteKnowledge = await core.memory.getSiteKnowledge(domain);
    const learnings = await core.memory.getLearnings(domain);
    const knowledgeSink = createWsSink(clients, commandId);
    const pageCount = siteKnowledge ? Object.keys(siteKnowledge.pages).length : 0;
    knowledgeSink.log(
      siteKnowledge
        ? `Knowledge for ${domain}: ${pageCount} pages, ${learnings.length} learnings.`
        : "No knowledge yet. Use \"l:\" to learn a website.",
    );
    broadcast({
      type: "command_result",
      id: commandId,
      payload: {
        message: JSON.stringify({ siteKnowledge, learnings }),
        success: true,
        mode: "knowledge",
        durationMs: 0,
      } satisfies CommandResultPayload,
    });
    return;
  }

  // Help command
  if (lower === "help") {
    const helpSink = createWsSink(clients, commandId);
    helpSink.log(getHelpText());
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "help", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  // Quit/exit — acknowledge but don't shut down the server
  if (lower === "quit" || lower === "exit") {
    const quitSink = createWsSink(clients, commandId);
    quitSink.info("The agent server keeps running. Close the browser tab to disconnect.");
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "quit", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  // Reports query (used by the Reports view)
  if (lower === "__get_reports") {
    try {
      const { default: prisma } = await import("./db.js");
      const rows = await prisma.testReport.findMany({
        orderBy: { timestamp: "desc" },
        take: 50,
      });
      const reports = rows.map((r: any) => ({
        title: r.title,
        timestamp: r.timestamp?.toISOString?.() ?? r.timestamp,
        domain: r.domain,
        steps: (r.steps ?? []).map((s: any) => ({
          action: s.step?.action ?? s.action ?? "",
          expected: s.step?.expected ?? s.expected ?? "",
          setup: s.step?.setup ?? s.setup ?? false,
          browser: s.step?.browser ?? s.browser,
          verdict: s.verdict ?? "skip",
          actual: s.actual ?? "",
          evidence: s.evidence ?? "",
          screenshotBefore: toScreenshotUrl(s.screenshotBefore),
          screenshotAfter: toScreenshotUrl(s.screenshotAfter),
          durationMs: s.durationMs ?? 0,
        })),
        verdict: r.verdict,
        summary: r.summary ?? "",
        durationMs: r.durationMs ?? 0,
        costUsd: r.costUsd ?? 0,
      }));
      broadcast({
        type: "command_result",
        id: commandId,
        payload: { message: JSON.stringify(reports), success: true, mode: "reports", durationMs: 0 } satisfies CommandResultPayload,
      });
    } catch (err) {
      broadcast({
        type: "error",
        id: commandId,
        payload: { message: err instanceof Error ? err.message : String(err) },
      });
      broadcast({
        type: "command_result",
        id: commandId,
        payload: { message: "Failed to fetch reports", success: false, mode: "reports", durationMs: 0 } satisfies CommandResultPayload,
      });
    }
    return;
  }

  // Conversation management commands
  if (lower === "conv" || lower === "conversations" || lower === "conversation:list") {
    const convs = await core.memory.listConversations();
    const payload: ConversationListPayload = {
      conversations: convs,
      activeId: core.memory.activeConversationId,
    };
    broadcast({ type: "conversation_list", id: commandId, payload });
    const lines = convs.map((c) => {
      const active = c.id === core.memory.activeConversationId ? " *" : "  ";
      return `${active} ${c.title} (${c.messageCount} msgs, ${new Date(c.updatedAt).toLocaleDateString()}) [${c.id.slice(0, 8)}]`;
    });
    const sink = createWsSink(clients, commandId);
    sink.info(`${convs.length} conversation(s):\n${lines.join("\n")}`);
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "conv", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  const convNewMatch = trimmed.match(/^conv(?:ersation)?[:\s]new(?:\s+(.+))?$/i);
  if (convNewMatch) {
    const title = convNewMatch[1]?.trim() || undefined;
    const { conversation, messages } = await core.createConversation(title);
    const payload: ConversationSwitchedPayload = { conversation, messages };
    broadcast({ type: "conversation_switched", id: commandId, payload });
    const sink = createWsSink(clients, commandId);
    sink.success(`New conversation: "${conversation.title}"`);
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "conv", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  const convSwitchMatch = trimmed.match(/^conv(?:ersation)?[:\s]switch\s+(.+)$/i);
  if (convSwitchMatch) {
    const target = convSwitchMatch[1].trim();
    try {
      const { conversation, messages } = await core.switchConversation(target);
      const payload: ConversationSwitchedPayload = { conversation, messages };
      broadcast({ type: "conversation_switched", id: commandId, payload });
      const sink = createWsSink(clients, commandId);
      sink.success(`Switched to: "${conversation.title}" (${messages.length} messages)`);
    } catch (err) {
      const sink = createWsSink(clients, commandId);
      sink.error(err instanceof Error ? err.message : String(err));
    }
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "conv", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  const convRenameMatch = trimmed.match(/^conv(?:ersation)?[:\s]rename\s+(.+)$/i);
  if (convRenameMatch) {
    const newTitle = convRenameMatch[1].trim();
    await core.memory.renameConversation(core.memory.activeConversationId, newTitle);
    const sink = createWsSink(clients, commandId);
    sink.success(`Conversation renamed to: "${newTitle}"`);
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "conv", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  const convArchiveMatch = trimmed.match(/^conv(?:ersation)?[:\s]archive$/i);
  if (convArchiveMatch) {
    const oldId = core.memory.activeConversationId;
    await core.memory.archiveConversation(oldId);
    const messages = await core.memory.getConversationMessages(core.memory.activeConversationId);
    const conversation = (await core.memory.getActiveConversation())!;
    const payload: ConversationSwitchedPayload = { conversation, messages };
    broadcast({ type: "conversation_switched", id: commandId, payload });
    const sink = createWsSink(clients, commandId);
    sink.success(`Conversation archived. Now on: "${conversation.title}"`);
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "conv", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  if (lower === "conversation:current" || lower === "__get_conversation") {
    const conversation = await core.memory.getActiveConversation();
    if (conversation) {
      const messages = await core.memory.getConversationMessages(conversation.id);
      const payload: ConversationCurrentPayload = { conversation, messages };
      broadcast({ type: "conversation_current", id: commandId, payload });
    }
    broadcast({
      type: "command_result",
      id: commandId,
      payload: { message: "OK", success: true, mode: "conv", durationMs: 0 } satisfies CommandResultPayload,
    });
    return;
  }

  // Standard agent commands
  const startTime = Date.now();
  const command = parseCommand(trimmed);
  const commandSink = createWsSink(clients, commandId, core.memory);

  // Persist user input and auto-title conversation
  core.memory.addConversationMessage({
    role: "user",
    type: "input",
    content: trimmed,
    mode: command.mode,
    commandId,
  });
  core.memory.autoTitleConversation(trimmed).then(async (changed) => {
    if (!changed) return;
    const convs = await core.memory.listConversations();
    const payload: ConversationListPayload = {
      conversations: convs,
      activeId: core.memory.activeConversationId ?? "",
    };
    broadcast({ type: "conversation_list", id: commandId, payload });
  }).catch(() => {});

  try {
    await core.orchestrator.execute(command, commandSink, signal);
  } catch (err) {
    if (isAbortError(err)) {
      commandSink.warn("Command aborted by user.");
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      commandSink.error(`Command failed: ${msg}`);
    }
  }
  commandSink.flushStream();
  broadcast({ type: "stream_end", id: commandId, payload: {} });
  const durationMs = Date.now() - startTime;

  const session = core.costTracker.getSessionTotal();
  const billing = core.costTracker.getBillingCycleTotal();
  broadcast({
    type: "cost_update",
    id: commandId,
    payload: {
      action: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      session,
      billing: {
        costUsd: billing.costUsd,
        inputTokens: billing.inputTokens,
        outputTokens: billing.outputTokens,
        sessionCount: billing.sessionCount,
        cycleStart: billing.cycleStart,
      },
    } satisfies CostUpdatePayload,
  });

  broadcast({ type: "browser_state", id: commandId, payload: buildBrowserState(core) });

  broadcast({
    type: "command_result",
    id: commandId,
    payload: {
      message: "Command completed",
      success: true,
      mode: command.mode,
      durationMs,
    } satisfies CommandResultPayload,
  });
}

async function main() {
  const clients = new Set<WebSocket>();
  const activeCommands = new Map<string, AbortController>();
  const sink = createWsSink(clients);

  console.log("[agent-server] Starting agent core...");
  const core = await createAgentCore(sink);
  console.log(`[agent-server] Agent ready. Starting server on port ${PORT}...`);

  const SCREENSHOTS_DIR = path.resolve("data", "screenshots");

  const httpServer = http.createServer((req, res) => {
    // CORS headers for frontend access
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url?.startsWith("/screenshots/")) {
      const fileName = decodeURIComponent(req.url.slice("/screenshots/".length));
      const safeName = path.basename(fileName);
      const filePath = path.join(SCREENSHOTS_DIR, safeName);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const ext = path.extname(safeName).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
      };

      res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", async (ws) => {
    clients.add(ws);
    console.log(`[agent-server] Client connected (${clients.size} total)`);

    // Send initial browser state
    ws.send(JSON.stringify({
      type: "browser_state",
      payload: buildBrowserState(core),
    } satisfies WSMessage));

    // Send initial cost/billing state
    try {
      const session = core.costTracker.getSessionTotal();
      const billing = core.costTracker.getBillingCycleTotal();
      ws.send(JSON.stringify({
        type: "cost_update",
        payload: {
          action: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          session,
          billing: {
            costUsd: billing.costUsd,
            inputTokens: billing.inputTokens,
            outputTokens: billing.outputTokens,
            sessionCount: billing.sessionCount,
            cycleStart: billing.cycleStart,
          },
        } satisfies CostUpdatePayload,
      } satisfies WSMessage));
    } catch { /* non-fatal */ }

    // Send current conversation + message history for replay
    try {
      const conversation = await core.memory.getActiveConversation();
      if (conversation) {
        const messages = await core.memory.getConversationMessages(conversation.id);
        ws.send(JSON.stringify({
          type: "conversation_current",
          payload: { conversation, messages } satisfies ConversationCurrentPayload,
        }));
      }
    } catch { /* non-fatal */ }

    ws.on("message", async (data) => {
      let msg: WSMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", payload: { message: "Invalid JSON" } }));
        return;
      }

      if (msg.type === "abort") {
        const controller = msg.id ? activeCommands.get(msg.id) : undefined;
        if (controller) {
          controller.abort();
          console.log(`[agent-server] Abort requested for command ${msg.id}`);
        }
        return;
      }

      if (msg.type === "command") {
        const { raw } = msg.payload as { raw: string };
        const ac = new AbortController();
        if (msg.id) activeCommands.set(msg.id, ac);
        try {
          await handleCommand(raw, core, clients, msg.id, ac.signal);
        } catch (err) {
          const errMessage = err instanceof Error ? err.message : String(err);
          const broadcastAll = (m: WSMessage) => {
            const d = JSON.stringify(m);
            for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(d);
          };
          broadcastAll({
            type: "error",
            id: msg.id,
            payload: { message: errMessage },
          });
          broadcastAll({
            type: "command_result",
            id: msg.id,
            payload: { message: errMessage, success: false, mode: "error", durationMs: 0 } satisfies CommandResultPayload,
          });
        } finally {
          if (msg.id) activeCommands.delete(msg.id);
        }
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`[agent-server] Client disconnected (${clients.size} total)`);
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`[agent-server] Server listening on http://localhost:${PORT}`);
    console.log(`[agent-server] WebSocket: ws://localhost:${PORT}`);
    console.log(`[agent-server] Screenshots: http://localhost:${PORT}/screenshots/`);
  });

  process.on("SIGINT", async () => {
    console.log("\n[agent-server] Shutting down...");
    wss.close();
    httpServer.close();
    await core.shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[agent-server] Fatal error:", err);
  process.exit(1);
});
