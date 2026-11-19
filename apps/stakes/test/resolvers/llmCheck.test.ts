import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  definitions: {} as Record<string, (request: { payload?: unknown; context?: unknown }) => unknown>,
  userDeps: vi.fn(),
  runConnectorSpike: vi.fn(),
}));

vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));
vi.mock('@forge/api', () => ({ default: { asUser: vi.fn(), asApp: vi.fn() }, route: vi.fn() }));
vi.mock('@forge/kvs', () => ({ kvs: { entity: () => ({}) }, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/teamwork-graph', () => ({ graph: {}, types: {} }));
vi.mock('@forge/resolver', () => ({
  default: class {
    define(name: string, fn: (request: { payload?: unknown; context?: unknown }) => unknown) {
      mocks.definitions[name] = fn;
    }
    getDefinitions() {
      return mocks.definitions;
    }
  },
}));
vi.mock('../../src/resolvers/deps.js', () => ({ userDeps: mocks.userDeps }));
vi.mock('../../src/services/connectorSpike.js', () => ({
  runConnectorSpike: mocks.runConnectorSpike,
}));

const { llmCheck } = await import('../../src/resolvers/index.js');

describe('llmCheck', () => {
  it('reports the model reply and any missing models', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const llm = {
      complete: vi.fn().mockResolvedValue({
        text: 'ready',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
      missingModels: vi.fn().mockResolvedValue([]),
    };
    expect(await llmCheck(llm)).toEqual({
      ok: true,
      data: {
        text: 'ready',
        model: 'm',
        usage: { inputTokens: 1, outputTokens: 1 },
        missingModels: [],
      },
    });
  });

  it('turns a failed call into a degraded result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const llm = { complete: vi.fn().mockRejectedValue(new Error('x')), missingModels: vi.fn() };
    expect(await llmCheck(llm)).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DEGRADED' } });
  });
});

describe('connectorSpike resolver', () => {
  const isAdmin = vi.fn();
  const canView = vi.fn();
  const request = (payload: unknown) =>
    mocks.definitions.connectorSpike!({
      payload,
      context: { accountId: 'acc-1', cloudId: 'cloud-1', siteUrl: 'https://example.atlassian.net' },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userDeps.mockReturnValue({ jira: { isAdmin, canView } });
  });

  it('rejects non-admins before checking issue access', async () => {
    isAdmin.mockResolvedValue(false);
    expect(await request({ issueKey: 'PAY-142', confirmed: true })).toMatchObject({
      ok: false,
      error: { code: 'NOT_ADMIN' },
    });
    expect(canView).not.toHaveBeenCalled();
    expect(mocks.runConnectorSpike).not.toHaveBeenCalled();
  });

  it('requires confirmation before checking issue access or writing test objects', async () => {
    isAdmin.mockResolvedValue(true);
    expect(await request({ issueKey: 'PAY-142' })).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(canView).not.toHaveBeenCalled();
    expect(mocks.runConnectorSpike).not.toHaveBeenCalled();
  });

  it('rejects inaccessible issues before running the spike', async () => {
    isAdmin.mockResolvedValue(true);
    canView.mockResolvedValue(false);
    expect(await request({ issueKey: 'pay-142', confirmed: true })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(canView).toHaveBeenCalledWith('PAY-142');
    expect(mocks.runConnectorSpike).not.toHaveBeenCalled();
  });

  it('runs a confirmed spike for an admin who can view the issue', async () => {
    isAdmin.mockResolvedValue(true);
    canView.mockResolvedValue(true);
    mocks.runConnectorSpike.mockResolvedValue({ ok: true, data: { accepted: 2 } });

    expect(await request({ issueKey: ' pay-142 ', confirmed: true })).toEqual({
      ok: true,
      data: { accepted: 2 },
    });
    expect(canView).toHaveBeenCalledWith('PAY-142');
    expect(mocks.runConnectorSpike).toHaveBeenCalledWith(
      expect.anything(),
      'PAY-142',
      'https://example.atlassian.net',
    );
  });
});
