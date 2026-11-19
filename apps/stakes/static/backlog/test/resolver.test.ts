import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@forge/bridge';
import { call } from '../src/lib/resolver';

vi.mock('@forge/bridge', () => ({ invoke: vi.fn() }));

describe('resolver calls', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('returns resolver data', async () => {
    vi.mocked(invoke).mockResolvedValue({ ok: true, data: { score: 89 } });
    await expect(call('getStakes', { issueKey: 'PAY-142' })).resolves.toEqual({ score: 89 });
  });

  it('preserves actionable resolver errors', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Ask a Jira admin for project access.' },
    });
    await expect(call('listBacklog', { projectKey: 'PAY' })).rejects.toThrow(
      'Ask a Jira admin for project access.',
    );
  });

  it('replaces raw transport errors with a retry message', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('upstream stack and request details'));
    await expect(call('listBacklog', { projectKey: 'PAY' })).rejects.toThrow(
      'Stakes could not reach its backend. Try again.',
    );
  });
});
