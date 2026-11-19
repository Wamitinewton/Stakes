import { vi } from 'vitest';
import type { BridgeCrmProperty } from '@stakes/contracts';
import type { GraphReader, GraphResult } from '../../src/adapters/graph.js';
import type { IssueDetails, JiraReader, LinkedRequest } from '../../src/adapters/jira.js';
import {
  makeHistoryStore,
  makeMirrorStore,
  makePercentileStore,
  makeSettingsStore,
  makeSnapshotStore,
} from '../../src/adapters/storage.js';
import type { GetStakesDeps } from '../../src/services/getStakes.js';
import type { TextWriter } from '../../src/adapters/llm.js';
import { fakeKvs } from './kvs.js';

export const NOW = new Date('2026-11-20T10:00:00.000Z');
export const SITE = 'https://example.atlassian.net';

export const degraded = <T>(): GraphResult<T> => ({
  ok: false,
  degraded: true,
  reason: 'partial-errors',
});

export function issueDetails(overrides: Partial<IssueDetails> = {}): IssueDetails {
  return {
    key: 'PAY-142',
    id: '10042',
    projectKey: 'PAY',
    summary: 'CSV export times out above 10k rows',
    status: 'To Do',
    statusCategory: 'new',
    priority: 'Low',
    assigneeAccountId: null,
    fixVersions: [],
    components: [],
    storyPoints: 5,
    labels: [],
    updated: '2026-11-19T08:00:00.000Z',
    url: `${SITE}/browse/PAY-142`,
    ...overrides,
  };
}

// Behaves like the writer with the LLM switched off: every request gets its fallback.
export function templateWriter() {
  return {
    write: vi.fn<TextWriter['write']>(async (req) => ({
      text: req.fallback?.text ?? '',
      citedIds: req.fallback?.citedIds ?? [],
      generated: false,
      reason: 'disabled' as const,
    })),
  };
}

export interface FakeSources {
  issue?: IssueDetails | null;
  requests?: LinkedRequest[];
  hidden?: number;
  bridge?: BridgeCrmProperty | null;
  graph?: Partial<{ [K in keyof GraphReader]: GraphReader[K] }>;
}

// Real stores over the in-memory KVS, with scripted Jira and graph readers. Every
// graph method is a spy, so a test can assert that a cached load made no graph call.
export function fakeStakesDeps(sources: FakeSources = {}) {
  const store = fakeKvs();
  const graph = {
    dealsForIssue: vi.fn(sources.graph?.dealsForIssue ?? (async () => degraded<never>())),
    escalationsForIssue: vi.fn(async () => ({ ok: true as const, data: [] })),
    conversationsForIssue: vi.fn(
      sources.graph?.conversationsForIssue ?? (async () => degraded<never>()),
    ),
    goalsForIssue: vi.fn(
      sources.graph?.goalsForIssue ?? (async () => ({ ok: true as const, data: [] })),
    ),
    teamForIssue: vi.fn(async () => ({ ok: true as const, data: null })),
  };
  const jira = {
    issue: vi.fn(async () => (sources.issue === undefined ? issueDetails() : sources.issue)),
    linkedRequests: vi.fn(async () => ({
      requests: sources.requests ?? [],
      hidden: sources.hidden ?? 0,
    })),
    bridgeCrm: vi.fn(async () => sources.bridge ?? null),
  } satisfies Pick<JiraReader, 'issue' | 'linkedRequests' | 'bridgeCrm'>;
  const mirror = makeMirrorStore(store.kvs);
  const settings = makeSettingsStore(store.kvs);
  const history = makeHistoryStore(store.kvs);
  const scoreField = { set: vi.fn(async () => {}) };
  const writer = templateWriter();
  const deps: GetStakesDeps = {
    jira,
    graph,
    mirror,
    snapshots: makeSnapshotStore(store.kvs),
    history,
    settings,
    percentiles: makePercentileStore(store.kvs),
    scoreField,
    writer,
    siteUrl: SITE,
    clock: () => NOW,
  };
  return { deps, graph, jira, store, mirror, settings, history, scoreField, writer };
}

export const mirrorCustomer = (
  id: string,
  tier: 'enterprise' | 'mid-market' | 'smb',
  extra = {},
) => ({
  id,
  name: `Customer ${id}`,
  tier,
  arrUsd: 100000,
  renewalDate: '2027-06-30',
  ownerAccountId: `owner-${id}`,
  source: 'demo' as const,
  ...extra,
});

export const mirrorDeal = (
  id: string,
  customerId: string,
  amountUsd: number,
  probability: number,
  extra = {},
) => ({
  id,
  customerId,
  name: `Deal ${id}`,
  amountUsd,
  stage: 'Negotiation',
  probability,
  closeDate: '2026-12-15',
  closed: false,
  ownerAccountId: `deal-owner-${id}`,
  issueKeys: ['PAY-142'],
  source: 'demo' as const,
  ...extra,
});

export const linkedRequest = (key: string, extra: Partial<LinkedRequest> = {}): LinkedRequest => ({
  key,
  summary: `Request ${key}`,
  priority: 'Medium',
  createdAt: '2026-11-10T08:00:00.000Z',
  slaBreachAt: null,
  escalated: false,
  assigneeAccountId: 'agent-1',
  url: `${SITE}/browse/${key}`,
  ...extra,
});
