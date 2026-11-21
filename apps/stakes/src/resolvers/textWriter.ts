import { checkNumbers } from '../core/guard';
import { makeLlmClient, makeTextWriter, type TextWriter } from '../adapters/llm';
import type { LlmStore, SettingsStore } from '../adapters/storage';
import { promptBook } from '../services/prompts';

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
