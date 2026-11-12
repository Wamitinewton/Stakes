import { describe, expect, it, vi } from 'vitest';
import happy from '../fixtures/llm/chat.happy.json';
import parts from '../fixtures/llm/chat.parts.json';
import listed from '../fixtures/llm/list.happy.json';

vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));

const { extractText, extractUsage, makeLlmClient } = await import('../../src/adapters/llm.js');

describe('llm adapter', () => {
  it('reads text and token usage from a chat response', () => {
    expect(extractText(happy)).toBe('ready');
    expect(extractUsage(happy)).toEqual({ inputTokens: 24, outputTokens: 2 });
  });

  it('joins text content parts', () => {
    expect(extractText(parts)).toBe('ready');
    expect(extractUsage(parts)).toEqual({ inputTokens: null, outputTokens: null });
  });

  it('returns empty text for an unexpected shape rather than throwing', () => {
    expect(extractText({})).toBe('');
    expect(extractText(null)).toBe('');
  });

  it('sends the configured model id with a system and user message', async () => {
    const chat = vi.fn().mockResolvedValue(happy);
    const client = makeLlmClient({ chat, list: vi.fn() });
    const result = await client.complete({
      model: 'haiku',
      system: 'sys',
      user: 'hi',
      maxTokens: 10,
    });
    expect(chat).toHaveBeenCalledWith({
      model: 'claude-haiku-4-5-20251001',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      max_completion_tokens: 10,
      temperature: 0,
    });
    expect(result).toEqual({
      text: 'ready',
      model: 'claude-haiku-4-5-20251001',
      usage: { inputTokens: 24, outputTokens: 2 },
    });
  });

  it('reports configured models that are missing or deprecated at runtime', async () => {
    const client = makeLlmClient({ chat: vi.fn(), list: vi.fn().mockResolvedValue(listed) });
    expect(await client.missingModels()).toEqual(['claude-sonnet-4-6']);
  });
});
