export interface ModelPricing {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  "google/gemini-2.5-computer-use-preview-10-2025": {
    inputPerMillionTokens: 1.25,
    outputPerMillionTokens: 10.0,
  },
  "google/gemini-2.5-flash": {
    inputPerMillionTokens: 0.15,
    outputPerMillionTokens: 0.6,
  },
  // Future providers
  "anthropic/claude-sonnet-4-20250514": {
    inputPerMillionTokens: 3.0,
    outputPerMillionTokens: 15.0,
  },
  "openai/computer-use-preview": {
    inputPerMillionTokens: 3.0,
    outputPerMillionTokens: 12.0,
  },
};

export function getPricing(model: string): ModelPricing {
  return (
    PRICING_TABLE[model] ?? {
      inputPerMillionTokens: 0,
      outputPerMillionTokens: 0,
    }
  );
}
