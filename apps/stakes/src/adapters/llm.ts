import { chat as forgeChat, list as forgeList } from '@forge/llm';
import { MODELS, type ModelName } from './llm.models.js';

export interface Completion {
  text: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface CompletionRequest {
  model: ModelName;
  system: string;
  user: string;
  maxTokens: number;
}

export interface LlmClient {
  complete(req: CompletionRequest): Promise<Completion>;
  missingModels(): Promise<string[]>;
}

// The narrow slice of @forge/llm this adapter relies on, so tests can pass fakes and a
// change in the SDK's response shape fails one contract test instead of every caller.
export interface LlmSdk {
  chat(prompt: {
    model: string;
    messages: Array<{ role: 'system' | 'user'; content: string }>;
    max_completion_tokens?: number;
    temperature?: number;
  }): Promise<unknown>;
  list(): Promise<unknown>;
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export function extractText(response: unknown): string {
  const content = (response as ChatResponse)?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('')
      .trim();
  }
  return '';
}

export function extractUsage(response: unknown): Completion['usage'] {
  const usage = (response as ChatResponse)?.usage;
  return {
    inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : null,
    outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : null,
  };
}

export function makeLlmClient(sdk: LlmSdk = { chat: forgeChat, list: forgeList }): LlmClient {
  return {
    async complete({ model, system, user, maxTokens }) {
      const id = MODELS[model];
      const response = await sdk.chat({
        model: id,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_completion_tokens: maxTokens,
        temperature: 0,
      });
      return { text: extractText(response), model: id, usage: extractUsage(response) };
    },
    async missingModels() {
      const listed = (await sdk.list()) as { models?: Array<{ model?: string; status?: string }> };
      const active = new Set(
        (listed?.models ?? []).filter((m) => m.status !== 'deprecated').map((m) => m.model),
      );
      return Object.values(MODELS).filter((id) => !active.has(id));
    },
  };
}
