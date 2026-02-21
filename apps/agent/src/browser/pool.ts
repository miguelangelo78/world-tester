import { ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { CostTracker } from "../cost/tracker.js";
import { findPlaywrightChromium, launchChrome, buildStagehandLogger, type SinkHolder } from "./stagehand.js";
import type { OutputSink } from "../output-sink.js";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface SpawnOptions {
  profile?: "isolated" | "shared" | string;
  headless?: boolean;
  startUrl?: string;
}

export class BrowserInstance {
  readonly name: string;
  readonly stagehand: Stagehand;
  readonly chrome: ChildProcess;
  readonly profileDir: string;
  readonly sinkHolder: SinkHolder;
  private activeTabIndex = 0;

  constructor(
    name: string,
    stagehand: Stagehand,
    chrome: ChildProcess,
    profileDir: string,
    sinkHolder: SinkHolder,
  ) {
    this.name = name;
    this.stagehand = stagehand;
    this.chrome = chrome;
    this.profileDir = profileDir;
    this.sinkHolder = sinkHolder;
  }

  setSink(sink: OutputSink | null): void {
    this.sinkHolder.sink = sink;
  }

  tabs(): StagehandPage[] {
    return this.stagehand.context.pages();
  }

  activeTab(): StagehandPage {
    const pages = this.tabs();
    if (this.activeTabIndex >= pages.length) {
      this.activeTabIndex = Math.max(0, pages.length - 1);
    }
    return pages[this.activeTabIndex];
  }

  async newTab(url?: string): Promise<StagehandPage> {
    const page = await this.stagehand.context.newPage();
    this.activeTabIndex = this.tabs().length - 1;
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
    return page;
  }

  switchTab(indexOrUrl: number | string): StagehandPage {
    const pages = this.tabs();
    if (typeof indexOrUrl === "number") {
      if (indexOrUrl < 0 || indexOrUrl >= pages.length) {
        throw new Error(
          `Tab index ${indexOrUrl} out of range (0..${pages.length - 1})`,
        );
      }
      this.activeTabIndex = indexOrUrl;
      return pages[this.activeTabIndex];
    }

    const needle = indexOrUrl.toLowerCase();
    const idx = pages.findIndex((p) => p.url().toLowerCase().includes(needle));
    if (idx === -1) {
      throw new Error(`No tab matching "${indexOrUrl}"`);
    }
    this.activeTabIndex = idx;
    return pages[this.activeTabIndex];
  }

  /**
   * Bring the active tab to the foreground in both Stagehand's context
   * and the browser UI (via CDP Page.bringToFront) so VNC shows the right tab.
   */
  async focusActiveTab(): Promise<void> {
    const page = this.activeTab();
    try {
      await page.sendCDP("Page.bringToFront");
    } catch { /* best-effort */ }
    try {
      (this.stagehand.context as any).setActivePage?.(page);
    } catch { /* best-effort */ }
  }

  async closeTab(index?: number): Promise<void> {
    const pages = this.tabs();
    const target = index ?? this.activeTabIndex;
    if (target < 0 || target >= pages.length) {
      throw new Error(`Tab index ${target} out of range`);
    }
    if (pages.length <= 1) {
      throw new Error("Cannot close the last tab");
    }
    await pages[target].close();
    if (this.activeTabIndex >= this.tabs().length) {
      this.activeTabIndex = Math.max(0, this.tabs().length - 1);
    }
  }

  activeTabIdx(): number {
    return this.activeTabIndex;
  }

  getUrl(): string {
    try {
      return this.activeTab()?.url() ?? "about:blank";
    } catch {
      return "about:blank";
    }
  }

  getDomain(): string {
    try {
      return new URL(this.getUrl()).hostname;
    } catch {
      return "unknown";
    }
  }

  async close(): Promise<void> {
    try { await this.stagehand.close(); } catch { /* already closed */ }
    try { this.chrome.kill(); } catch { /* already dead */ }
  }
}

export class BrowserPool {
  private instances = new Map<string, BrowserInstance>();
  private activeId = "";
  private config: AppConfig;
  private costTracker?: CostTracker;
  private chromePath: string;

  constructor(config: AppConfig, costTracker?: CostTracker) {
    this.config = config;
    this.costTracker = costTracker;
    this.chromePath = findPlaywrightChromium();
  }

  async spawn(name: string, opts?: SpawnOptions): Promise<BrowserInstance> {
    if (this.instances.has(name)) {
      throw new Error(`Browser "${name}" already exists`);
    }

    const profileMode = opts?.profile ?? (this.instances.size === 0 ? "shared" : "isolated");
    let profileDir: string;
    if (profileMode === "shared") {
      profileDir = path.resolve("data", ".browser-profile");
    } else if (profileMode === "isolated") {
      profileDir = path.resolve("data", `.browser-profile-${name}`);
    } else {
      profileDir = path.resolve("data", profileMode);
    }
    fs.mkdirSync(profileDir, { recursive: true });

    const headless = opts?.headless ?? this.config.headless;

    const chrome = await launchChrome(this.chromePath, this.config, {
      profileDir,
      headless,
    });

    const sinkHolder: SinkHolder = { sink: null };
    const logger = buildStagehandLogger(this.costTracker, name, sinkHolder);

    const stagehand = new Stagehand({
      env: "LOCAL",
      model: this.config.utilityModel,
      localBrowserLaunchOptions: {
        cdpUrl: chrome.wsUrl,
        viewport: this.config.viewport,
      },
      logger,
    });

    await stagehand.init();

    const browser = new BrowserInstance(name, stagehand, chrome.process, profileDir, sinkHolder);

    if (opts?.startUrl) {
      const page = browser.activeTab();
      await page.goto(opts.startUrl, { waitUntil: "domcontentloaded" });
    }

    this.instances.set(name, browser);
    if (!this.activeId) {
      this.activeId = name;
    }

    return browser;
  }

  async despawn(name: string): Promise<void> {
    const browser = this.instances.get(name);
    if (!browser) {
      throw new Error(`Browser "${name}" not found`);
    }
    await browser.close();
    this.instances.delete(name);

    if (this.activeId === name) {
      const remaining = [...this.instances.keys()];
      this.activeId = remaining[0] ?? "";
    }
  }

  get(name: string): BrowserInstance {
    const browser = this.instances.get(name);
    if (!browser) {
      throw new Error(`Browser "${name}" not found`);
    }
    return browser;
  }

  active(): BrowserInstance {
    if (!this.activeId || !this.instances.has(this.activeId)) {
      throw new Error("No active browser. Spawn one first.");
    }
    return this.instances.get(this.activeId)!;
  }

  activeLabel(): string {
    return this.activeId || "none";
  }

  setActive(name: string): void {
    if (!this.instances.has(name)) {
      throw new Error(`Browser "${name}" not found`);
    }
    this.activeId = name;
  }

  list(): BrowserInstance[] {
    return [...this.instances.values()];
  }

  has(name: string): boolean {
    return this.instances.has(name);
  }

  findByStagehand(stagehand: Stagehand): BrowserInstance | undefined {
    for (const b of this.instances.values()) {
      if (b.stagehand === stagehand) return b;
    }
    return undefined;
  }

  size(): number {
    return this.instances.size;
  }

  async closeAll(): Promise<void> {
    for (const browser of this.instances.values()) {
      await browser.close();
    }
    this.instances.clear();
    this.activeId = "";
  }

  formatList(): string {
    const lines: string[] = [];
    for (const b of this.instances.values()) {
      const active = b.name === this.activeId ? chalk.green(" *") : "  ";
      const tabs = b.tabs();
      lines.push(`${active} ${chalk.bold(b.name)} (${tabs.length} tab${tabs.length !== 1 ? "s" : ""})`);
      for (let i = 0; i < tabs.length; i++) {
        const url = tabs[i].url();
        const short = url.length > 60 ? url.slice(0, 57) + "..." : url;
        const tabActive = i === b.activeTabIdx() ? chalk.cyan("→") : " ";
        lines.push(`    ${tabActive} [${i}] ${short}`);
      }
    }
    return lines.join("\n");
  }
}
