import { loadConfig, AppConfig } from "./config/index.js";
import { setupDatabase } from "./db.js";
import { BrowserPool } from "./browser/pool.js";
import { setPool } from "./browser/stagehand.js";
import { CostTracker } from "./cost/tracker.js";
import { MemoryManager } from "./memory/manager.js";
import { Orchestrator } from "./agent/orchestrator.js";
import { injectSessionContext } from "./agent/chat.js";
import type { OutputSink } from "./output-sink.js";

export interface AgentCore {
  config: AppConfig;
  pool: BrowserPool;
  orchestrator: Orchestrator;
  memory: MemoryManager;
  costTracker: CostTracker;
  shutdown: () => Promise<void>;
}

export async function createAgentCore(sink: OutputSink): Promise<AgentCore> {
  const config = loadConfig();
  sink.info(`Provider: ${config.provider} | Model: ${config.cuaModel}`);
  sink.info(`Headless: ${config.headless}`);

  sink.info("Connecting to database...");
  await setupDatabase();
  sink.success("Database ready");

  const memory = new MemoryManager(config.dataDir);
  await memory.init();
  sink.success("Memory system initialized");

  const costTracker = new CostTracker(config.cuaModel, config.dataDir);
  await costTracker.init();

  sink.info("Launching browser...");
  const pool = new BrowserPool(config, costTracker);
  setPool(pool);
  const mainBrowser = await pool.spawn("main");
  sink.success("Browser ready");

  if (config.targetUrl) {
    const page = mainBrowser.activeTab();
    await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
    sink.info(`Navigated to: ${config.targetUrl}`);
  }

  const orchestrator = new Orchestrator(pool, config, costTracker, memory);

  const previousEntries = await memory.loadPreviousSession();
  injectSessionContext(previousEntries);

  async function shutdown() {
    await memory.saveSession();
    await pool.closeAll();
  }

  return { config, pool, orchestrator, memory, costTracker, shutdown };
}
