// Forge LLMs pick the model per request. Keeping the ids in one place means a retired
// model is a one-line change, and the startup check can compare them with list().
export const MODELS = {
  // Default for summaries, ship notes and digests: cheapest and fast enough for 80–120 words.
  haiku: 'claude-haiku-4-5-20251001',
  // Customer-facing drafts only, where tone matters more than cost.
  sonnet: 'claude-sonnet-4-6',
} as const;

export type ModelName = keyof typeof MODELS;
