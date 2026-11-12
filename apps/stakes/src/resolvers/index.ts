import Resolver from '@forge/resolver';
import { isIssueKey } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import { makeLlmClient, type LlmClient } from '../adapters/llm.js';

export interface PanelHello {
  issueKey: string;
  message: string;
}

// Reads the issue key from the Forge invocation context rather than the payload, so a
// caller cannot ask about an issue other than the one the panel is rendered on.
export function panelHello(context: unknown): Result<PanelHello> {
  const issueKey = (context as { extension?: { issue?: { key?: unknown } } } | undefined)?.extension
    ?.issue?.key;
  if (!isIssueKey(issueKey)) return err('INVALID_INPUT', 'The panel has no issue context');
  return ok({ issueKey, message: `Stakes is installed and can see ${issueKey}.` });
}

export interface LlmCheck {
  text: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  missingModels: string[];
}

// A fixed, evidence-free prompt: it proves the Forge LLM path works end to end on the
// site without sending any issue data to the model.
export async function llmCheck(llm: LlmClient): Promise<Result<LlmCheck>> {
  try {
    const [completion, missingModels] = await Promise.all([
      llm.complete({
        model: 'haiku',
        system: 'You answer with exactly one word.',
        user: 'Reply with the word: ready',
        maxTokens: 10,
      }),
      llm.missingModels(),
    ]);
    console.log('llm-check ok', {
      model: completion.model,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      missingModels: missingModels.length,
    });
    return ok({ ...completion, missingModels });
  } catch (e) {
    console.error('llm-check failed', { name: e instanceof Error ? e.name : 'unknown' });
    return err('UPSTREAM_DEGRADED', 'The Forge LLM call failed; see forge logs.');
  }
}

const resolver = new Resolver();

resolver.define('panelHello', ({ context }) => panelHello(context));
resolver.define('llmCheck', () => llmCheck(makeLlmClient()));

export const handler = resolver.getDefinitions();
