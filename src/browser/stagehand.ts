import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { Stagehand } from "@browserbasehq/stagehand";
import { AppConfig } from "../config/types.js";
import { CostTracker } from "../cost/tracker.js";

let instance: Stagehand | null = null;
let chromeProcess: ChildProcess | null = null;

function findPlaywrightChromium(): string {
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

function launchChrome(
  executablePath: string,
  config: AppConfig,
): Promise<{ process: ChildProcess; wsUrl: string }> {
  return new Promise((resolve, reject) => {
    const profileDir = path.resolve("data", ".browser-profile");
    fs.mkdirSync(profileDir, { recursive: true });

    const args = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-gpu-rasterization",
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${config.viewport.width},${config.viewport.height + 87}`,
      `--user-data-dir=${profileDir}`,
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];

    if (config.headless) {
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

export async function initBrowser(
  config: AppConfig,
  costTracker?: CostTracker,
): Promise<Stagehand> {
  if (instance) return instance;

  const chromePath = findPlaywrightChromium();
  const chrome = await launchChrome(chromePath, config);
  chromeProcess = chrome.process;

  let pendingStep = "";

  const stagehand = new Stagehand({
    env: "LOCAL",
    model: config.utilityModel,
    localBrowserLaunchOptions: {
      cdpUrl: chrome.wsUrl,
      viewport: config.viewport,
    },
    logger: (logLine) => {
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
        process.stdout.write(
          chalk.dim(`  [step ${stepLabel}${tool}]`) +
            (detail ? chalk.dim(detail) : "") +
            "\n",
        );
        return;
      }

      if (msg.includes("Reasoning:") || msg.includes("reasoning:")) {
        const reasoning = msg.replace(/.*[Rr]easoning:\s*/, "").trim();
        if (reasoning.length > 0) {
          process.stdout.write(chalk.dim.italic(`  [thinking] ${reasoning}\n`));
        }
      }
    },
  });

  await stagehand.init();
  instance = stagehand;
  return stagehand;
}

export async function closeBrowser(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
  if (chromeProcess) {
    chromeProcess.kill();
    chromeProcess = null;
  }
}

export function getStagehand(): Stagehand {
  if (!instance) {
    throw new Error("Browser not initialized. Call initBrowser() first.");
  }
  return instance;
}

export function getCurrentUrl(): string {
  const stagehand = getStagehand();
  const page = stagehand.context.pages()[0];
  return page?.url() ?? "about:blank";
}

export function getDomain(): string {
  try {
    const url = getCurrentUrl();
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
