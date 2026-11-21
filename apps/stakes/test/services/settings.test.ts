import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_SEED_STATUS, makeSettingsStore } from '../../src/adapters/storage';
import { getSettingsView, saveSettings, validateBands } from '../../src/services/settings';
import { fakeKvs } from '../fakes/kvs';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});

const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

function deps(priorities = PRIORITIES) {
  return {
    jira: {
      isAdmin: vi.fn(async () => true),
      priorities: vi.fn(async () => priorities),
      projects: vi.fn(async () => [{ key: 'PAY', name: 'Orbit Pay', type: 'software' }]),
    },
    settings: makeSettingsStore(fakeKvs().kvs),
    connections: { get: async () => 'conn-1' },
    confluence: {
      isConnected: vi.fn(async () => true),
      parentPages: vi.fn(async () => [{ id: '100', title: 'Team updates' }]),
    },
    digest: { lastRun: async () => null },
    seed: { status: async () => EMPTY_SEED_STATUS },
  };
}

describe('getSettingsView', () => {
  it('gathers settings, site priorities, projects, connector and seed state', async () => {
    expect(await getSettingsView(deps())).toEqual({
      ok: true,
      data: {
        settings: DEFAULT_SETTINGS,
        isAdmin: true,
        priorities: PRIORITIES,
        projects: [{ key: 'PAY', name: 'Orbit Pay', type: 'software' }],
        connectorConnected: true,
        confluenceConnected: true,
        confluencePages: [{ id: '100', title: 'Team updates' }],
        digestLastRun: null,
        seed: EMPTY_SEED_STATUS,
      },
    });
  });

  it('still answers when Jira lookups fail', async () => {
    const d = deps();
    d.jira.priorities.mockRejectedValue(new Error('x'));
    d.jira.projects.mockRejectedValue(new Error('x'));
    expect(await getSettingsView(d)).toMatchObject({
      ok: true,
      data: { priorities: [], projects: [] },
    });
  });
});

describe('saveSettings', () => {
  it('renormalises weights and bumps the version when they change', async () => {
    const d = deps();
    const r = await saveSettings(d, { weights: { R: 2, S: 2, C: 0, H: 0, G: 0, U: 0 } });
    expect(r).toMatchObject({
      ok: true,
      data: { weights: { R: 0.5, S: 0.5, C: 0 }, weightsVersion: 2 },
    });
    expect((await d.settings.get()).weightsVersion).toBe(2);
  });

  it('keeps the version when weights only change scale', async () => {
    const d = deps();
    const doubled = Object.fromEntries(
      Object.entries(DEFAULT_SETTINGS.weights).map(([k, v]) => [k, v * 2]),
    );
    expect(await saveSettings(d, { weights: doubled as never })).toMatchObject({
      ok: true,
      data: { weightsVersion: 1 },
    });
  });

  it('rejects all-zero weights', async () => {
    expect(
      await saveSettings(deps(), { weights: { R: 0, S: 0, C: 0, H: 0, G: 0, U: 0 } }),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('saves bands and invalidates snapshots when they change', async () => {
    const bands = {
      ...DEFAULT_SETTINGS.bands,
      thresholds: { highest: 80, high: 60, medium: 40, low: 20 },
    };
    expect(await saveSettings(deps(), { bands })).toMatchObject({
      ok: true,
      data: { bands, weightsVersion: 2 },
    });
  });

  it('saves digest settings and requires a parent when enabled', async () => {
    const d = deps();
    expect(await saveSettings(d, { digestEnabled: true })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(await saveSettings(d, { digestEnabled: true, digestParentPageId: '100' })).toMatchObject(
      {
        ok: true,
        data: { digestEnabled: true, digestParentPageId: '100' },
      },
    );
    expect(await saveSettings(d, { digestEnabled: false, digestParentPageId: null })).toMatchObject(
      { ok: true, data: { digestEnabled: false, digestParentPageId: null } },
    );
  });

  it('dedupes projects in scope and keeps the version', async () => {
    expect(
      await saveSettings(deps(), { projectsInScope: ['PAY', 'PAY', 'WEB'], jumpThreshold: 25 }),
    ).toMatchObject({
      ok: true,
      data: { projectsInScope: ['PAY', 'WEB'], jumpThreshold: 25, weightsVersion: 1 },
    });
  });
});

describe('validateBands', () => {
  const ok = DEFAULT_SETTINGS.bands;
  it('accepts the defaults', () => {
    expect(validateBands(ok, PRIORITIES)).toBeNull();
  });

  it.each([
    [
      'out of order',
      { ...ok, thresholds: { highest: 50, high: 55, medium: 35, low: 15 } },
      'Each band must start above the one below it',
    ],
    [
      'out of range',
      { ...ok, thresholds: { highest: 101, high: 55, medium: 35, low: 15 } },
      'Band thresholds must be whole numbers from 1 to 100',
    ],
    [
      'an unknown priority',
      { ...ok, priorities: { ...ok.priorities, highest: 'P0' } },
      'P0 is not a priority on this site',
    ],
  ])('rejects bands %s', (_l, bands, message) => {
    expect(validateBands(bands, PRIORITIES)).toBe(message);
  });

  it('allows an unmapped band and skips the name check when priorities are unknown', () => {
    expect(
      validateBands({ ...ok, priorities: { ...ok.priorities, highest: null } }, PRIORITIES),
    ).toBeNull();
    expect(
      validateBands({ ...ok, priorities: { ...ok.priorities, highest: 'P0' } }, []),
    ).toBeNull();
  });
});
