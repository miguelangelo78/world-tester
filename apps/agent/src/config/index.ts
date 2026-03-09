import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppConfig } from "./types.js";

// Load .env from monorepo root (two levels up from apps/agent/src/config)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", "..", ".env") });

export function loadConfig(): AppConfig {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY. Copy .env.example to .env and fill in your key.",
    );
    process.exit(1);
  }

  // Build apiUrl from the agent server's own port
  const agentPort = process.env.AGENT_PORT ?? "3100";
  const apiUrl = `http://localhost:${agentPort}`;

  return {
    provider: "google",
    cuaModel: "google/gemini-2.5-computer-use-preview-10-2025",
    utilityModel: "google/gemini-2.5-flash",
    apiKey,
    generativeAiApiKey: apiKey,
    headless: process.env.HEADLESS === "true",
    targetUrl: process.env.TARGET_URL || undefined,
    dataDir: "./data",
    apiUrl,
    viewport: { width: 1288, height: 711 },
  };
}

export type { AppConfig } from "./types.js";
