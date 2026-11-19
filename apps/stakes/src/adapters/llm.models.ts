// Forge LLMs pick the model per request. Keeping the ids in one place means a retired
// model is a one-line change, and the startup check can compare them with list().
export const MODELS = {
  // Default for summaries, ship notes and digests: cheapest and fast enough for 80–120 words.
  haiku: 'claude-haiku-4-5-20251001',
  // Customer-facing drafts only, where tone matters more than cost.
  sonnet: 'claude-sonnet-4-6',
} as const;

export type ModelName = keyof typeof MODELS;

// Forge LLMs bill in credits but the SDK reports tokens, so spend is estimated from
// tokens with these per-model rates. They keep the models' relative cost (Sonnet is
// about three times Haiku) and are labelled as estimates wherever they are shown.
export const CREDITS_PER_1K_TOKENS: Record<ModelName, { input: number; output: number }> = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 3, output: 15 },
};

export function estimateCredits(model: ModelName, inputTokens: number, outputTokens: number) {
  const rate = CREDITS_PER_1K_TOKENS[model];
  return (inputTokens * rate.input + outputTokens * rate.output) / 1000;
}
