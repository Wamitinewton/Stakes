import { describe, expect, it, vi } from 'vitest';
import type { EvidenceItem } from '@stakes/contracts';
import { checkNumbers } from '../../src/core/guard.js';
import { dealEvidence } from '../../src/core/evidence.js';
import { fakeKvs } from '../fakes/kvs.js';

vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));

const { makeTextWriter, stripCitations } = await import('../../src/adapters/llm.js');
const { makeLlmStore } = await import('../../src/adapters/storage.js');
const { promptBook } = await import('../../src/services/prompts.js');

const NOW = new Date('2026-11-20T10:00:00.000Z');

const EVIDENCE: EvidenceItem[] = [
  dealEvidence(
    {
      id: 'DEAL-031',
      name: 'Enterprise expansion',
      customerId: 'CUST-007',
      customerName: 'Kilima Freight',
      amountUsd: 220_000,
      probability: 0.6,
      stage: 'Negotiation',
      closeDate: '2026-12-15',
      closed: false,
      ownerAccountId: 'owner-1',
      url: 'https://example.atlassian.net/deal/DEAL-031',
    },
    'mirror',
    NOW.toISOString(),
  ),
];

const request = (extra = {}) => ({
  purpose: 'summary' as const,
  cacheKey: 'abc123:summary',
  evidence: EVIDENCE,
  context: { issueKey: 'PAY-142', issueSummary: 'CSV export times out' },
  fallback: { text: 'Template sentence.', citedIds: ['ev-deal-DEAL-031'] },
  ...extra,
});

function setup(opts: { enabled?: boolean; budget?: number; reply?: string; usage?: boolean } = {}) {
  const kvs = fakeKvs();
  const store = makeLlmStore(kvs.kvs);
  const complete = vi.fn(async () => {
    if (opts.reply === undefined) throw new Error('boom');
    return {
      text: opts.reply,
      model: 'claude-haiku-4-5-20251001',
      usage:
        opts.usage === false
          ? { inputTokens: null, outputTokens: null }
          : { inputTokens: 2000, outputTokens: 100 },
    };
  });
  const settings = {
    get: vi.fn(async () => ({
      llmEnabled: opts.enabled ?? true,
      dailyLlmBudgetCredits: opts.budget ?? 500,
    })),
  };
  const writer = makeTextWriter({
    llm: { complete },
    store,
    settings,
    clock: () => NOW,
    guard: checkNumbers,
    prompts: promptBook,
  });
  return { writer, store, complete, settings };
}

const GOOD =
  'Kilima Freight has US$220K riding on this [ev-deal-DEAL-031]. It closes 15 Dec 2026 [ev-deal-DEAL-031].';

describe('text writer', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('returns the template without calling the model when the LLM is off', async () => {
    const { writer, complete } = setup({ enabled: false, reply: GOOD });
    expect(await writer.write(request())).toEqual({
      text: 'Template sentence.',
      citedIds: ['ev-deal-DEAL-031'],
      generated: false,
      reason: 'disabled',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('generates, guards, caches and records usage', async () => {
    const { writer, store, complete } = setup({ reply: GOOD });
    expect(await writer.write(request())).toEqual({
      text: GOOD,
      citedIds: ['ev-deal-DEAL-031'],
      generated: true,
    });
    const prompt = (complete.mock.calls[0] as unknown[])[0] as { model: string; user: string };
    expect(prompt.model).toBe('haiku');
    expect(prompt.user).toContain('ISSUE: PAY-142 — CSV export times out');
    expect(await store.usage('2026-11-20')).toEqual({
      credits: 2.5,
      calls: 1,
      inputTokens: 2000,
      outputTokens: 100,
    });
    expect(await store.cached('abc123:summary')).toMatchObject({ text: GOOD });
  });

  it('serves the cache without calling the model or spending budget', async () => {
    const { writer, store, complete } = setup({ reply: GOOD });
    await writer.write(request());
    await writer.write(request());
    expect(complete).toHaveBeenCalledTimes(1);
    expect((await store.usage('2026-11-20')).calls).toBe(1);
  });

  it('refreshes the last-used time of a cache entry older than a day', async () => {
    const { writer, store } = setup({ reply: GOOD });
    await store.saveCached('abc123:summary', {
      text: GOOD,
      citedIds: [],
      createdAt: '2026-11-01T00:00:00.000Z',
      usedAt: '2026-11-01T00:00:00.000Z',
    });
    await writer.write(request());
    expect((await store.cached('abc123:summary'))!.usedAt).toBe(NOW.toISOString());
  });

  it('falls back once the day’s budget is spent, and with a budget of zero', async () => {
    const spent = setup({ reply: GOOD, budget: 2 });
    await spent.store.addUsage('2026-11-20', {
      credits: 2,
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(await spent.writer.write(request())).toMatchObject({
      generated: false,
      reason: 'budget',
    });
    expect(spent.complete).not.toHaveBeenCalled();

    const zero = setup({ reply: GOOD, budget: 0 });
    expect(await zero.writer.write(request())).toMatchObject({
      generated: false,
      reason: 'budget',
    });
  });

  it('reads the budget on every call, so a change applies to the next one', async () => {
    const { writer, settings, complete } = setup({ reply: GOOD, budget: 0 });
    expect((await writer.write(request())).reason).toBe('budget');
    settings.get.mockResolvedValue({ llmEnabled: true, dailyLlmBudgetCredits: 500 });
    expect((await writer.write(request())).generated).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects an invented number, counts the rejection and still records the spend', async () => {
    const { writer, store } = setup({ reply: 'Kilima Freight has US$5M riding on this.' });
    expect(await writer.write(request())).toMatchObject({
      text: 'Template sentence.',
      generated: false,
      reason: 'guard',
    });
    expect(await store.rejections('2026-11-20')).toBe(1);
    expect((await store.usage('2026-11-20')).calls).toBe(1);
    expect(await store.cached('abc123:summary')).toBeNull();
  });

  it('rejects a forbidden name', async () => {
    const { writer } = setup({ reply: 'Your fix shipped, like it did for Savanna Health.' });
    expect(
      await writer.write(request({ purpose: 'customer', forbiddenNames: ['Savanna Health'] })),
    ).toMatchObject({ generated: false, reason: 'guard' });
  });

  it('falls back on an error and on an empty reply', async () => {
    expect(await setup().writer.write(request())).toMatchObject({ reason: 'error' });
    expect(await setup({ reply: '' }).writer.write(request())).toMatchObject({ reason: 'error' });
  });

  it('estimates tokens from text length when the SDK reports no usage', async () => {
    const { writer, store } = setup({ reply: GOOD, usage: false });
    await writer.write(request());
    const usage = await store.usage('2026-11-20');
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBe(Math.ceil(GOOD.length / 4));
  });

  it('uses the prompt book template when no fallback is passed', async () => {
    const { writer } = setup({ enabled: false });
    const r = await writer.write(request({ fallback: undefined, purpose: 'ship-internal' }));
    expect(r.text).toMatch(/^PAY-142 \(CSV export times out\) has shipped\./);
  });

  it('removes evidence ids from customer-facing text and uses Sonnet', async () => {
    const { writer, complete } = setup({ reply: 'Your fix has shipped [ev-deal-DEAL-031].' });
    const r = await writer.write(
      request({
        purpose: 'customer',
        context: { issueKey: 'PAY-142', issueSummary: 'x', tone: 'brief' },
      }),
    );
    expect(r).toEqual({
      text: 'Your fix has shipped.',
      citedIds: ['ev-deal-DEAL-031'],
      generated: true,
    });
    expect(((complete.mock.calls[0] as unknown[])[0] as { model: string }).model).toBe('sonnet');
  });

  it('logs purpose and counts only, never the text or names', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await setup({ reply: GOOD }).writer.write(request());
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('Kilima');
    expect(logged).not.toContain('220');
    expect(logged).toContain('generated');
  });
});

describe('stripCitations', () => {
  it('drops bracketed ids and the space before punctuation', () => {
    expect(stripCitations('Shipped [ev-a] today [ev-b, ev-c].')).toBe('Shipped today.');
    expect(stripCitations('No ids [here].')).toBe('No ids [here].');
  });
});
