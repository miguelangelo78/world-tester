import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { AppConfig } from "../config/types.js";
import { CostTracker } from "../cost/tracker.js";
import type { OutputSink } from "../output-sink.js";
import type { BrowserPool } from "./pool.js";

/**
 * Mutable holder so the long-lived Stagehand logger can route output
 * through whichever OutputSink is active for the current command.
 */
export interface SinkHolder {
  sink: OutputSink | null;
}

let _pool: BrowserPool | null = null;

export function setPool(pool: BrowserPool): void {
  _pool = pool;
}

function pool(): BrowserPool {
  if (!_pool) throw new Error("BrowserPool not initialized. Call setPool() first.");
  return _pool;
}

// ── Reusable helpers (used by BrowserPool.spawn) ──────────────────────

export function findPlaywrightChromium(): string {
  const cacheDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    `${process.env.HOME}/.cache/ms-playwright`;
  const dirs = fs
    .readdirSync(cacheDir)
    .filter((d) => d.startsWith("chromium-"))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = path.join(cacheDir, dir, "chrome-linux64", "chrome");
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Playwright Chromium not found. Run: npx playwright install chromium",
  );
}

export interface LaunchOptions {
  profileDir: string;
  headless: boolean;
}

export function launchChrome(
  executablePath: string,
  config: AppConfig,
  opts: LaunchOptions,
): Promise<{ process: ChildProcess; wsUrl: string }> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(opts.profileDir, { recursive: true });

    const useKiosk = process.env.BROWSER_KIOSK === "1" || process.env.BROWSER_KIOSK === "true";

    const args = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-gpu-rasterization",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${config.viewport.width},${config.viewport.height}`,
      `--user-data-dir=${opts.profileDir}`,
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      ...(useKiosk ? ["--kiosk"] : []),
    ];

    if (opts.headless) {
      args.push("--headless=new");
    }

    const proc = spawn(executablePath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":0" },
    });

    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Chrome launch timed out. stderr:\n${stderr}`));
      proc.kill();
    }, 15000);

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ process: proc, wsUrl: match[1] });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (!stderr.includes("DevTools listening on")) {
        reject(
          new Error(`Chrome exited with code ${code}. stderr:\n${stderr}`),
        );
      }
    });
  });
}

export function buildStagehandLogger(
  costTracker?: CostTracker,
  browserName?: string,
  sinkHolder?: SinkHolder,
): (logLine: unknown) => void {
  let pendingStep = "";
  const prefix = browserName && browserName !== "main"
    ? chalk.dim(`[${browserName}] `)
    : "";
  const plainPrefix = browserName && browserName !== "main"
    ? `[${browserName}] `
    : "";

  return (logLine: unknown) => {
    const entry = logLine as Record<string, unknown>;

    if (costTracker) {
      const inputTokens = entry.inputTokens as number | undefined;
      const outputTokens = entry.outputTokens as number | undefined;
      if (
        typeof inputTokens === "number" &&
        typeof outputTokens === "number"
      ) {
        costTracker.addTokens(inputTokens, outputTokens);
      }
    }

    const msg = String(entry.msg ?? entry.message ?? "");
    const auxiliary = entry.auxiliary as
      | Record<string, { value?: string }>
      | undefined;
    const sink = sinkHolder?.sink;

    if (msg.includes("Executing step")) {
      const m = msg.match(/Executing step (\d+)\/(\d+)/);
      if (m) pendingStep = `${m[1]}/${m[2]}`;
      return;
    }

    if (msg.includes("Agent calling tool:")) {
      const tool = msg.replace(/.*Agent calling tool:\s*/, "");
      let detail = "";

      if (auxiliary?.instruction?.value) {
        detail = ` → "${auxiliary.instruction.value.slice(0, 80)}"`;
      } else if (auxiliary?.url?.value) {
        detail = ` → ${auxiliary.url.value}`;
      } else if (auxiliary?.arguments?.value) {
        try {
          const parsed = JSON.parse(auxiliary.arguments.value);
          if (Array.isArray(parsed)) {
            const summary = parsed
              .map((f: { action?: string }) => f.action ?? "")
              .filter(Boolean)
              .join(", ");
            if (summary) detail = ` → ${summary.slice(0, 100)}`;
          } else {
            detail = ` → "${String(auxiliary.arguments.value).slice(0, 80)}"`;
          }
        } catch {
          detail = ` → "${auxiliary.arguments.value.slice(0, 80)}"`;
        }
      } else if (auxiliary?.direction?.value) {
        detail = ` ${auxiliary.direction.value}`;
      }

      const stepLabel = pendingStep ? `${pendingStep} ` : "";
      pendingStep = "";

      if (sink) {
        sink.log(`${plainPrefix}[step ${stepLabel}${tool}]${detail}`);
      } else {
        process.stdout.write(
          prefix +
          chalk.dim(`  [step ${stepLabel}${tool}]`) +
            (detail ? chalk.dim(detail) : "") +
            "\n",
        );
      }
      return;
    }

    if (msg.includes("Reasoning:") || msg.includes("reasoning:")) {
      const reasoning = msg.replace(/.*[Rr]easoning:\s*/, "").trim();
      if (reasoning.length > 0) {
        if (sink) {
          sink.log(`${plainPrefix}[thinking] ${reasoning}`);
        } else {
          process.stdout.write(prefix + chalk.dim.italic(`  [thinking] ${reasoning}\n`));
        }
      }
    }
  };
}

// ── Pool-backed compat layer ──────────────────────────────────────────
// These keep the existing import signatures working across modes.ts, learning.ts, etc.

/**
 * Take a screenshot.  When `stagehandOverride` is provided the screenshot is
 * taken from that specific Stagehand instance (i.e. a particular browser from
 * the pool); otherwise it falls back to the currently-active browser.
 */
export async function captureScreenshot(
  label: string,
  stagehandOverride?: import("@browserbasehq/stagehand").Stagehand,
): Promise<string> {
  const page = stagehandOverride
    ? ((stagehandOverride.context as any).activePage?.() ?? stagehandOverride.context.pages()[0])
    : pool().active().activeTab();
  if (!page) throw new Error("No active page for screenshot");

  const dir = path.resolve("data", "screenshots");
  fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  const fileName = `${ts}_${safeName}.png`;
  const filePath = path.join(dir, fileName);

  const buffer = await page.screenshot({ fullPage: false });
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

export function getStagehand() {
  return pool().active().stagehand;
}

export function getCurrentUrl(): string {
  return pool().active().getUrl();
}

export function getDomain(): string {
  return pool().active().getDomain();
}
