export type Provider = "google" | "anthropic" | "openai";

export interface AppConfig {
  provider: Provider;
  cuaModel: string;
  utilityModel: string;
  apiKey: string;
  generativeAiApiKey: string;
  headless: boolean;
  targetUrl?: string;
  dataDir: string;
  viewport: { width: number; height: number };
  apiUrl?: string;
}
