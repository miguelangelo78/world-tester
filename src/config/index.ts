import "dotenv/config";
import { AppConfig } from "./types.js";

export function loadConfig(): AppConfig {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    console.error(
      "Missing GOOGLE_GENERATIVE_AI_API_KEY. Copy .env.example to .env and fill in your key.",
    );
    process.exit(1);
  }

  return {
    provider: "google",
    cuaModel: "google/gemini-2.5-computer-use-preview-10-2025",
    utilityModel: "google/gemini-2.5-flash",
    apiKey,
    headless: process.env.HEADLESS === "true",
    targetUrl: process.env.TARGET_URL || undefined,
    dataDir: "./data",
    viewport: { width: 1288, height: 711 },
  };
}

export type { AppConfig } from "./types.js";
