import { checkNumbers } from '../core/guard.js';
import { makeLlmClient, makeTextWriter, type TextWriter } from '../adapters/llm.js';
import type { LlmStore, SettingsStore } from '../adapters/storage.js';
import { promptBook } from '../services/prompts.js';

// The one place the Forge LLM client, the numeric guard and the prompt book are put
// together, so resolvers, triggers and actions all generate text the same way.
export function makeWriter(deps: {
  llm: LlmStore;
  settings: Pick<SettingsStore, 'get'>;
}): TextWriter {
  return makeTextWriter({
    llm: makeLlmClient(),
    store: deps.llm,
    settings: deps.settings,
    clock: () => new Date(),
    guard: checkNumbers,
    prompts: promptBook,
  });
}
