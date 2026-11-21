import { chat as forgeChat, list as forgeList } from '@forge/llm';
import type { EvidenceItem, Settings } from '@stakes/contracts';
import { citedIds, type GuardOptions, type GuardResult } from '../core/guard.js';
import { MODELS, estimateCredits, type ModelName } from './llm.models.js';
import type { LlmStore } from './storage.js';

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

// ---------------------------------------------------------------------------------
// TextWriter: every generated sentence in Stakes goes through here, so the switch,
// cache, budget and numeric guard apply to all of them the same way.
// ---------------------------------------------------------------------------------

export type TextPurpose = 'summary' | 'ship-internal' | 'customer' | 'digest';

export interface WriteRequest {
  purpose: TextPurpose;
  // Deterministic hash of the evidence and trusted prompt context.
  cacheKey: string;
  evidence: EvidenceItem[];
  // Trusted facts the prompt carries: issueKey, issueSummary, versionName, customerName,
  // tone. Numbers in them may be repeated by the model.
  context: Record<string, string>;
  // Untrusted ticket or comment excerpts. They are quoted for the model as data and
  // never vouch for a number.
  data?: string[];
  // Names the output must not contain, such as other customers in a customer draft.
  forbiddenNames?: string[];
  // Text to show when no generated text can be used. Callers that already compute a
  // richer template than the prompt book can (the summary) pass it here.
  fallback?: { text: string; citedIds: string[] };
}

export interface WrittenText {
  text: string;
  generated: boolean;
  citedIds: string[];
  reason?: 'disabled' | 'budget' | 'guard' | 'error';
}

export interface TextWriter {
  write(req: WriteRequest): Promise<WrittenText>;
}

export interface BuiltPrompt {
  model: ModelName;
  system: string;
  user: string;
  maxTokens: number;
  // Customer-facing text must not show internal evidence ids.
  stripCitations: boolean;
}

export interface PromptBook {
  build(req: WriteRequest): BuiltPrompt;
  template(req: WriteRequest): { text: string; citedIds: string[] };
}

export type Guard = (text: string, evidence: EvidenceItem[], opts: GuardOptions) => GuardResult;

export interface TextWriterDeps {
  llm: Pick<LlmClient, 'complete'>;
  store: Pick<LlmStore, 'cached' | 'saveCached' | 'usage' | 'addUsage' | 'addRejection'>;
  settings: { get(): Promise<Pick<Settings, 'llmEnabled' | 'dailyLlmBudgetCredits'>> };
  clock: () => Date;
  guard: Guard;
  prompts: PromptBook;
}

const DAY_MS = 86_400_000;

export function stripCitations(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\bev-[^\]]*\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

// Rough token count for when the SDK omits usage: about four characters a token.
const approxTokens = (text: string) => Math.ceil(text.length / 4);

export function makeTextWriter(deps: TextWriterDeps): TextWriter {
  return {
    async write(req) {
      const fallback = (reason: NonNullable<WrittenText['reason']>): WrittenText => {
        const t = req.fallback ?? deps.prompts.template(req);
        console.log('llm text', { purpose: req.purpose, outcome: reason });
        return { text: t.text, citedIds: t.citedIds, generated: false, reason };
      };

      try {
        const settings = await deps.settings.get();
        if (!settings.llmEnabled) return fallback('disabled');

        const now = deps.clock();
        const cached = await deps.store.cached(req.cacheKey);
        if (cached) {
          // Touch at most daily, so a hot entry is not rewritten on every read but
          // still survives the unused-for-30-days purge.
          if (now.getTime() - new Date(cached.usedAt).getTime() > DAY_MS) {
            await deps.store
              .saveCached(req.cacheKey, { ...cached, usedAt: now.toISOString() })
              .catch(() => {});
          }
          console.log('llm text', { purpose: req.purpose, outcome: 'cache' });
          return { text: cached.text, citedIds: cached.citedIds, generated: true };
        }

        const day = now.toISOString().slice(0, 10);
        const used = await deps.store.usage(day);
        if (used.credits >= settings.dailyLlmBudgetCredits) return fallback('budget');

        const prompt = deps.prompts.build(req);
        const completion = await deps.llm.complete(prompt);
        const inputTokens =
          completion.usage.inputTokens ?? approxTokens(prompt.system + prompt.user);
        const outputTokens = completion.usage.outputTokens ?? approxTokens(completion.text);
        await deps.store.addUsage(day, {
          credits: estimateCredits(prompt.model, inputTokens, outputTokens),
          calls: 1,
          inputTokens,
          outputTokens,
        });
        if (completion.text === '') return fallback('error');

        const verdict = deps.guard(completion.text, req.evidence, {
          issueKey: req.context.issueKey,
          context: Object.values(req.context),
          forbiddenNames: req.forbiddenNames,
        });
        if (!verdict.ok) {
          await deps.store.addRejection(day);
          console.log('llm guard rejected', {
            purpose: req.purpose,
            offending: verdict.offending.length,
          });
          return fallback('guard');
        }

        const ids = citedIds(completion.text);
        const text = prompt.stripCitations ? stripCitations(completion.text) : completion.text;
        await deps.store.saveCached(req.cacheKey, {
          text,
          citedIds: ids,
          createdAt: now.toISOString(),
          usedAt: now.toISOString(),
        });
        console.log('llm text', {
          purpose: req.purpose,
          outcome: 'generated',
          inputTokens,
          outputTokens,
        });
        return { text, citedIds: ids, generated: true };
      } catch (e) {
        console.warn('llm text failed', {
          purpose: req.purpose,
          error: e instanceof Error ? e.name : 'unknown',
        });
        return fallback('error');
      }
    },
  };
}
